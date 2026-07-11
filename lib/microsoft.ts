import { createHmac } from "crypto"
import { encryptString, decryptString } from "@/lib/crypto"
import { prisma } from "@/lib/prisma"

export const MICROSOFT_GRAPH_ROOT = "https://graph.microsoft.com/v1.0"
const GRAPH_BASE = `${MICROSOFT_GRAPH_ROOT}/me`
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"

const SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "Mail.Read",
  "Mail.Send",
  "Mail.ReadWrite",
  "User.Read",
].join(" ")

function redirectUri() {
  return `${process.env.NEXTAUTH_URL}/api/connectors/outlook/callback`
}

// ── OAuth2 ─────────────────────────────────────────────────────────────────

export function buildOutlookAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: SCOPES,
    state,
    prompt: "consent",
    response_mode: "query",
  })
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`
}

export type OutlookTokens = {
  accessToken: string
  refreshToken: string
  expiresAt: Date
}

export async function exchangeOutlookCode(code: string): Promise<OutlookTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri(),
    }),
  })
  const data = (await res.json()) as Record<string, unknown>
  if (!res.ok || !data.access_token || !data.refresh_token) {
    throw new Error(
      (data.error_description as string | undefined) ?? "Token exchange failed"
    )
  }
  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    expiresAt: new Date(Date.now() + (data.expires_in as number) * 1000),
  }
}

async function refreshOutlookToken(refreshToken: string): Promise<OutlookTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      refresh_token: refreshToken,
    }),
  })
  const data = (await res.json()) as Record<string, unknown>
  if (!res.ok || !data.access_token) {
    throw new Error(
      (data.error_description as string | undefined) ?? "Token refresh failed"
    )
  }
  return {
    accessToken: data.access_token as string,
    refreshToken: (data.refresh_token as string | undefined) ?? refreshToken,
    expiresAt: new Date(Date.now() + (data.expires_in as number) * 1000),
  }
}

// Returns a fresh access token, auto-refreshing if expired
export async function getOutlookAccessToken(channelId: string): Promise<string> {
  const cred = await prisma.outlookCredential.findUnique({ where: { channelId } })
  if (!cred) throw new Error("No Outlook credential found for channel")

  const expiry = cred.tokenExpiry?.getTime() ?? 0
  if (Date.now() < expiry - 60_000) {
    return decryptString(cred.accessTokenEncrypted)
  }

  const refreshed = await refreshOutlookToken(decryptString(cred.refreshTokenEncrypted))
  await prisma.outlookCredential.update({
    where: { channelId },
    data: {
      accessTokenEncrypted: encryptString(refreshed.accessToken),
      refreshTokenEncrypted: encryptString(refreshed.refreshToken),
      tokenExpiry: refreshed.expiresAt,
    },
  })
  return refreshed.accessToken
}

// ── State signing (mirrors lib/google.ts signState/verifyState) ─────────────

export function signOutlookState(tenantId: string): string {
  const ts = Date.now().toString()
  const hmac = createHmac("sha256", process.env.NEXTAUTH_SECRET!)
    .update(`ms:${tenantId}:${ts}`)
    .digest("hex")
  return Buffer.from(`ms:${tenantId}:${ts}:${hmac}`).toString("base64url")
}

export function verifyOutlookState(state: string): string | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8")
    const parts = decoded.split(":")
    if (parts.length < 4 || parts[0] !== "ms") return null
    const hmac = parts[parts.length - 1]
    const ts = parts[parts.length - 2]
    const tenantId = parts.slice(1, parts.length - 2).join(":")
    const expected = createHmac("sha256", process.env.NEXTAUTH_SECRET!)
      .update(`ms:${tenantId}:${ts}`)
      .digest("hex")
    if (hmac !== expected) return null
    if (Date.now() - parseInt(ts) > 10 * 60 * 1000) return null
    return tenantId
  } catch {
    return null
  }
}

// ── Graph API helpers ────────────────────────────────────────────────────────

export class MicrosoftGraphError extends Error {
  constructor(
    public readonly status: number,
    public readonly code?: string
  ) {
    super(`Microsoft Graph request failed (${status}${code ? `, ${code}` : ""})`)
    this.name = "MicrosoftGraphError"
  }
}

export async function graphGet<T>(
  path: string,
  token: string,
  headers: Record<string, string> = {}
): Promise<T> {
  const url = path.startsWith("https://") ? path : `${GRAPH_BASE}${path}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, ...headers },
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: { code?: string }
    }
    throw new MicrosoftGraphError(res.status, err.error?.code)
  }
  return res.json() as Promise<T>
}

export async function graphRequest<T>(
  path: string,
  token: string,
  options: { method: "POST" | "PATCH" | "DELETE"; body?: unknown }
): Promise<T> {
  const url = path.startsWith("https://") ? path : `${MICROSOFT_GRAPH_ROOT}${path}`
  const hasBody = options.body !== undefined
  const res = await fetch(url, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
    },
    body: hasBody ? JSON.stringify(options.body) : undefined,
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: { code?: string }
    }
    throw new MicrosoftGraphError(res.status, err.error?.code)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export async function getOutlookUserEmail(accessToken: string): Promise<string> {
  const data = await graphGet<{ mail?: string; userPrincipalName?: string }>(
    "/",
    accessToken
  )
  return (data.mail ?? data.userPrincipalName ?? "").toLowerCase()
}

// ── Types ────────────────────────────────────────────────────────────────────

export type GraphMessage = {
  id: string
  conversationId: string
  subject: string
  from: { emailAddress: { address: string; name: string } }
  toRecipients: Array<{ emailAddress: { address: string; name: string } }>
  body: { content: string; contentType: string }
  receivedDateTime: string
  internetMessageId?: string
  isRead?: boolean
  categories?: string[]
}

type GraphMessageList = { value: GraphMessage[]; "@odata.nextLink"?: string }

// Compatibility wrapper while all callers migrate to the shared delta runner.
export async function syncOutlookChannel(channelId: string, tenantId: string): Promise<number> {
  const { runOutlookDeltaSync } = await import("@/lib/outlook-sync")
  const result = await runOutlookDeltaSync({
    channelId,
    tenantId,
    requestedMode: "manual",
  })
  return "synced" in result ? result.synced : 0
}

// ── Send ─────────────────────────────────────────────────────────────────────

export async function sendOutlookReply({
  channelId,
  to,
  cc,
  bcc,
  subject,
  body,
  conversationId,
}: {
  channelId: string
  to: string
  cc?: string[]
  bcc?: string[]
  subject: string
  body: string
  conversationId: string // Microsoft conversationId (= externalThreadId)
}): Promise<string> {
  const token = await getOutlookAccessToken(channelId)
  const ccRecipients = (cc ?? []).map((address) => ({ emailAddress: { address } }))
  const bccRecipients = (bcc ?? []).map((address) => ({ emailAddress: { address } }))

  // Find the last message in this conversation to reply to
  const params = new URLSearchParams({
    $filter: `conversationId eq '${conversationId}' and isDraft eq false`,
    $orderby: "receivedDateTime desc",
    $top: "1",
    $select: "id",
  })
  const latest = await graphGet<GraphMessageList>(`/messages?${params}`, token)
  const lastMessageId = latest.value[0]?.id

  if (lastMessageId) {
    // Use the reply API to preserve threading
    const replyRes = await fetch(
      `${GRAPH_BASE}/messages/${lastMessageId}/reply`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            toRecipients: [{ emailAddress: { address: to } }],
            ...(ccRecipients.length > 0 ? { ccRecipients } : {}),
            ...(bccRecipients.length > 0 ? { bccRecipients } : {}),
          },
          comment: body,
        }),
      }
    )
    if (!replyRes.ok) {
      const err = (await replyRes.json().catch(() => ({}))) as {
        error?: { message?: string }
      }
      throw new Error(err.error?.message ?? "Outlook reply failed")
    }
    // reply API doesn't return the new message ID; use a synthetic ID
    return `reply_to_${lastMessageId}`
  }

  // Fallback: send a new message if no prior message found
  const sendRes = await fetch(`${GRAPH_BASE}/sendMail`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject: subject.toLowerCase().startsWith("re:")
          ? subject
          : `Re: ${subject}`,
        body: { contentType: "Text", content: body },
        toRecipients: [{ emailAddress: { address: to } }],
        ...(ccRecipients.length > 0 ? { ccRecipients } : {}),
        ...(bccRecipients.length > 0 ? { bccRecipients } : {}),
      },
    }),
  })
  if (!sendRes.ok) {
    const err = (await sendRes.json().catch(() => ({}))) as {
      error?: { message?: string }
    }
    throw new Error(err.error?.message ?? "Outlook send failed")
  }
  return `new_${Date.now()}`
}
