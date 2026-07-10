import { prisma } from "@/lib/prisma"
import { encryptString, decryptString } from "@/lib/crypto"

export type OpenRouterRuntimeKey = {
  apiKey: string
  keyHash: string | null
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

  const limit = Number(process.env.OPENROUTER_CHILD_KEY_MONTHLY_LIMIT_USD ?? "10")
  const res = await fetch("https://openrouter.ai/api/v1/keys", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_MANAGEMENT_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `flowdesk:user:${input.userId}:${input.email}`,
      limit: Number.isFinite(limit) ? limit : 10,
      limit_reset: "monthly",
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

  await prisma.openRouterUserKey.create({
    data: {
      tenantId: input.tenantId,
      userId: input.userId,
      keyHash,
      keyLabel,
      encryptedApiKey: encryptString(apiKey),
      limitUsd: Number.isFinite(limit) ? limit : 10,
      limitReset: "monthly",
    },
  })

  return { apiKey, keyHash }
}
