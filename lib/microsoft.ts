import { createHmac } from "crypto"
import { encryptString, decryptString } from "@/lib/crypto"
import { prisma } from "@/lib/prisma"
import { syncConversationWorkItems } from "@/lib/agent/work-item-sync"

const GRAPH_BASE = "https://graph.microsoft.com/v1.0/me"
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

async function graphGet<T>(path: string, token: string): Promise<T> {
  const url = path.startsWith("https://") ? path : `${GRAPH_BASE}${path}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: { message?: string }
    }
    throw new Error(
      err.error?.message ?? `Graph GET ${path} failed (${res.status})`
    )
  }
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

type GraphMessage = {
  id: string
  conversationId: string
  subject: string
  from: { emailAddress: { address: string; name: string } }
  toRecipients: Array<{ emailAddress: { address: string; name: string } }>
  body: { content: string; contentType: string }
  receivedDateTime: string
  internetMessageId?: string
}

type GraphMessageList = { value: GraphMessage[]; "@odata.nextLink"?: string }

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

// ── Sync ─────────────────────────────────────────────────────────────────────

export async function syncOutlookChannel(
  channelId: string,
  tenantId: string
): Promise<number> {
  const channel = await prisma.channel.findUnique({ where: { id: channelId } })
  if (!channel?.emailAddress) throw new Error("Not an email channel")

  const token = await getOutlookAccessToken(channelId)
  const myEmail = channel.emailAddress.toLowerCase()

  // Fetch 50 most recent inbox messages to discover unique conversation IDs
  const params = new URLSearchParams({
    $top: "50",
    $select:
      "id,conversationId,subject,from,toRecipients,body,receivedDateTime,internetMessageId",
    $orderby: "receivedDateTime desc",
    $filter: "isDraft eq false",
  })

  const inbox = await graphGet<GraphMessageList>(
    `/mailFolders/inbox/messages?${params}`,
    token
  )

  // Collect up to 25 unique conversation IDs
  const seenConvIds = new Set<string>()
  const conversationIds: string[] = []
  for (const msg of inbox.value) {
    if (msg.conversationId && !seenConvIds.has(msg.conversationId)) {
      seenConvIds.add(msg.conversationId)
      conversationIds.push(msg.conversationId)
      if (conversationIds.length >= 25) break
    }
  }

  let synced = 0

  for (const convId of conversationIds) {
    // Fetch all messages in this conversation thread (inbox + sent)
    const convParams = new URLSearchParams({
      $select:
        "id,conversationId,subject,from,toRecipients,body,receivedDateTime,internetMessageId",
      $orderby: "receivedDateTime asc",
      $filter: `conversationId eq '${convId}' and isDraft eq false`,
      $top: "50",
    })

    let threadMessages: GraphMessage[] = []
    try {
      const convMsgs = await graphGet<GraphMessageList>(
        `/messages?${convParams}`,
        token
      )
      threadMessages = convMsgs.value
    } catch {
      // Some messages may be in Sent or other folders — fall back to inbox messages for this convId
      threadMessages = inbox.value.filter((m) => m.conversationId === convId)
    }

    if (threadMessages.length === 0) continue

    const firstMsg = threadMessages[0]
    const lastMsg = threadMessages[threadMessages.length - 1]

    // Determine external participant (the one that isn't ours)
    const fromEmail = firstMsg.from.emailAddress.address.toLowerCase()
    const isFirstOutbound = fromEmail === myEmail
    const externalAddress = isFirstOutbound
      ? firstMsg.toRecipients[0]?.emailAddress
      : firstMsg.from.emailAddress
    const externalEmail = (externalAddress?.address ?? "").toLowerCase()
    const externalName = externalAddress?.name || externalEmail

    if (!externalEmail) continue

    // Auto-create or find contact (email stored in phoneE164, matching Gmail pattern)
    let contact = await prisma.contact.findUnique({
      where: { tenantId_phoneE164: { tenantId, phoneE164: externalEmail } },
    })
    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          tenantId,
          name: externalName || externalEmail,
          phoneE164: externalEmail,
        },
      })
    }

    // externalThreadId = Microsoft conversationId
    const conversation = await prisma.conversation.upsert({
      where: {
        tenantId_channelId_externalThreadId: {
          tenantId,
          channelId,
          externalThreadId: convId,
        },
      },
      create: {
        tenantId,
        channelId,
        externalThreadId: convId,
        contactId: contact.id,
        status: "needs_reply",
        lastMessageAt: new Date(lastMsg.receivedDateTime),
      },
      update: {
        lastMessageAt: new Date(lastMsg.receivedDateTime),
        contactId: contact.id,
      },
    })

    for (const msg of threadMessages) {
      const msgFrom = msg.from.emailAddress.address.toLowerCase()
      const isOutbound = msgFrom === myEmail
      const bodyText =
        msg.body.contentType === "html"
          ? stripHtml(msg.body.content)
          : msg.body.content

      await prisma.message.upsert({
        where: { providerMessageId: `outlook_${msg.id}` },
        create: {
          conversationId: conversation.id,
          direction: isOutbound ? "outbound" : "inbound",
          fromE164: msg.from.emailAddress.address,
          toE164: msg.toRecipients.map((r) => r.emailAddress.address).join(", "),
          body: bodyText || `[${msg.subject}]`,
          providerMessageId: `outlook_${msg.id}`,
          createdAt: new Date(msg.receivedDateTime),
        },
        update: {},
      })
    }

    syncConversationWorkItems({ tenantId, conversationId: conversation.id }).catch(() => null)
    synced++
  }

  await prisma.outlookCredential.update({
    where: { channelId },
    data: { lastSyncedAt: new Date(), lastSyncError: null },
  })

  return synced
}

// ── Send ─────────────────────────────────────────────────────────────────────

export async function sendOutlookReply({
  channelId,
  to,
  subject,
  body,
  conversationId,
}: {
  channelId: string
  to: string
  subject: string
  body: string
  conversationId: string // Microsoft conversationId (= externalThreadId)
}): Promise<string> {
  const token = await getOutlookAccessToken(channelId)

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
