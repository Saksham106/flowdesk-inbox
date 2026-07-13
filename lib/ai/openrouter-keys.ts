import { prisma } from "@/lib/prisma"
import { encryptString, decryptString } from "@/lib/crypto"

export type OpenRouterRuntimeKey = {
  apiKey: string
  keyHash: string | null
}

/**
 * Builds a human-readable OpenRouter key name so keys are identifiable by
 * account in the OpenRouter dashboard, e.g. "flowdesk-johndoe-4x9k2p" for
 * john.doe@gmail.com. Falls back to "user" if the email has no usable
 * local part. The suffix is derived from the userId (not random) so the
 * name is stable and reproducible across re-provisioning.
 */
export function buildOpenRouterKeyName(email: string, userId: string): string {
  const localPart = email.split("@")[0] ?? ""
  const slug = localPart.replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 24) || "user"
  const suffix = userId.replace(/[^a-zA-Z0-9]/g, "").slice(-6) || "000000"
  return `flowdesk-${slug}-${suffix}`
}

/**
 * Resolves the OpenRouter API key to use for a given FlowDesk user.
 *
 * One OpenRouter runtime child key per FlowDesk user (not per tenant):
 * - If the user already has an active (non-disabled) child key, reuse it.
 * - Otherwise, if OPENROUTER_MANAGEMENT_API_KEY is configured, provision a new
 *   child key via the OpenRouter management API and persist it.
 * - If no management key is configured, fall back to a single shared
 *   OPENROUTER_API_KEY, but ONLY outside production. Production fails closed.
 *
 * If OPENROUTER_WORKSPACE_ID is set, new child keys are created in that
 * OpenRouter workspace; otherwise OpenRouter creates them in the default
 * workspace for the account that owns OPENROUTER_MANAGEMENT_API_KEY.
 */
export async function getOpenRouterApiKeyForUser(input: {
  tenantId: string
  userId: string
  email: string
}): Promise<OpenRouterRuntimeKey> {
  const existing = await prisma.openRouterUserKey.findUnique({ where: { userId: input.userId } })
  if (existing && !existing.disabled) {
    await Promise.resolve(
      prisma.openRouterUserKey.update({
        where: { userId: input.userId },
        data: { lastUsedAt: new Date(), lastError: null },
      })
    ).catch(() => {})
    return { apiKey: decryptString(existing.encryptedApiKey), keyHash: existing.keyHash }
  }

  if (!process.env.OPENROUTER_MANAGEMENT_API_KEY) {
    if (process.env.NODE_ENV !== "production" && process.env.OPENROUTER_API_KEY) {
      return { apiKey: process.env.OPENROUTER_API_KEY, keyHash: null }
    }
    throw new Error("OPENROUTER_MANAGEMENT_API_KEY is not configured")
  }

  const limit = Number(process.env.OPENROUTER_CHILD_KEY_MONTHLY_LIMIT_USD ?? "3")
  const res = await fetch("https://openrouter.ai/api/v1/keys", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_MANAGEMENT_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: buildOpenRouterKeyName(input.email, input.userId),
      limit: Number.isFinite(limit) ? limit : 3,
      limit_reset: "monthly",
      // Omitted entirely (rather than sent as undefined/null) so OpenRouter
      // falls back to its own default workspace when unset.
      ...(process.env.OPENROUTER_WORKSPACE_ID ? { workspace_id: process.env.OPENROUTER_WORKSPACE_ID } : {}),
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(typeof data?.error?.message === "string" ? data.error.message : "OpenRouter key provisioning failed")
  }

  const apiKey = typeof data.key === "string" ? data.key : typeof data.value === "string" ? data.value : null
  const keyHash = typeof data.hash === "string" ? data.hash : typeof data.data?.hash === "string" ? data.data.hash : null
  const keyLabel = typeof data.label === "string" ? data.label : typeof data.data?.label === "string" ? data.data.label : "openrouter-child-key"

  if (!apiKey || !keyHash) throw new Error("OpenRouter key provisioning response was missing key/hash")

  const resolvedLimit = Number.isFinite(limit) ? limit : 3
  const encryptedApiKey = encryptString(apiKey)

  // `userId` is unique on this model, so a disabled row falls through to this
  // point (see the early-return guard above) and must be re-enabled in place
  // rather than inserted, or `create` throws a P2002 unique-constraint error.
  await prisma.openRouterUserKey.upsert({
    where: { userId: input.userId },
    create: {
      tenantId: input.tenantId,
      userId: input.userId,
      keyHash,
      keyLabel,
      encryptedApiKey,
      limitUsd: resolvedLimit,
      limitReset: "monthly",
    },
    update: {
      keyHash,
      keyLabel,
      encryptedApiKey,
      limitUsd: resolvedLimit,
      limitReset: "monthly",
      disabled: false,
      lastProvisionedAt: new Date(),
      lastError: null,
    },
  })

  return { apiKey, keyHash }
}
