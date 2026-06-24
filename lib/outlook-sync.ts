import { randomUUID } from "crypto"

import { syncConversationWorkItems } from "@/lib/agent/work-item-sync"
import { decryptString, encryptString } from "@/lib/crypto"
import {
  getOutlookAccessToken,
  graphGet,
  MicrosoftGraphError,
  type GraphMessage,
} from "@/lib/microsoft"
import { prisma } from "@/lib/prisma"

type RequestedSyncMode = "manual" | "oauth_callback" | "webhook" | "cron"

type RemovedGraphMessage = {
  id: string
  "@removed": { reason?: string }
}

type GraphDeltaPage = {
  value: Array<GraphMessage | RemovedGraphMessage>
  "@odata.nextLink"?: string
  "@odata.deltaLink"?: string
}

export type OutlookDeltaSyncResult =
  | {
      ok: true
      channelId: string
      synced: number
      deleted: number
      pages: number
      hasMore: boolean
      mode: `${RequestedSyncMode}_delta`
    }
  | { ok: true; channelId: string; skipped: "sync_in_progress" }
  | { ok: true; channelId: string; skipped: "cursor_reset" }

const SYNC_LEASE_MS = 2 * 60 * 1000
const DEFAULT_MAX_PAGES = 10
const DELTA_FIELDS = [
  "id",
  "conversationId",
  "subject",
  "from",
  "toRecipients",
  "body",
  "receivedDateTime",
  "internetMessageId",
  "isRead",
].join(",")

function initialDeltaPath(): string {
  const params = new URLSearchParams({ $select: DELTA_FIELDS })
  return `/mailFolders('inbox')/messages/delta?${params}`
}

function isRemovedMessage(
  message: GraphMessage | RemovedGraphMessage
): message is RemovedGraphMessage {
  return "@removed" in message
}

function bodyText(message: GraphMessage): string {
  const content = message.body?.content ?? ""
  if (message.body?.contentType?.toLowerCase() !== "html") return content
  return content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

async function persistCursor(channelId: string, leaseId: string, cursor: string): Promise<void> {
  const updated = await prisma.outlookCredential.updateMany({
    where: { channelId, syncLeaseId: leaseId },
    data: {
      deltaLinkEncrypted: encryptString(cursor),
      syncLockExpiresAt: new Date(Date.now() + SYNC_LEASE_MS),
    },
  })
  if (updated.count !== 1) throw new Error("Outlook sync lease lost")
}

async function applyRemovedMessage(
  providerId: string,
  affectedConversationIds: Set<string>
): Promise<boolean> {
  const existing = await prisma.message.findUnique({
    where: { providerMessageId: `outlook_${providerId}` },
    select: { id: true, conversationId: true },
  })
  if (!existing) return false

  await prisma.message.delete({ where: { id: existing.id } })
  affectedConversationIds.add(existing.conversationId)

  const latest = await prisma.message.findFirst({
    where: { conversationId: existing.conversationId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  })
  await prisma.conversation.update({
    where: { id: existing.conversationId },
    data: latest ? { lastMessageAt: latest.createdAt } : { status: "closed" },
  })
  return true
}

async function applyLiveMessage({
  message,
  channelId,
  tenantId,
  myEmail,
  affectedConversationIds,
}: {
  message: GraphMessage
  channelId: string
  tenantId: string
  myEmail: string
  affectedConversationIds: Set<string>
}): Promise<boolean> {
  if (!message.id || !message.conversationId || !message.from?.emailAddress?.address) {
    return false
  }

  const fromEmail = message.from.emailAddress.address.toLowerCase()
  const externalAddress =
    fromEmail === myEmail
      ? message.toRecipients.find(
          (recipient) => recipient.emailAddress.address.toLowerCase() !== myEmail
        )?.emailAddress
      : message.from.emailAddress
  const externalEmail = externalAddress?.address?.toLowerCase() ?? ""
  if (!externalEmail) return false

  const externalName = externalAddress?.name?.trim() || externalEmail
  const contact = await prisma.contact.upsert({
    where: { tenantId_phoneE164: { tenantId, phoneE164: externalEmail } },
    create: { tenantId, name: externalName, phoneE164: externalEmail },
    update: { name: externalName },
  })

  const receivedAt = new Date(message.receivedDateTime)
  if (Number.isNaN(receivedAt.getTime())) return false

  const conversation = await prisma.conversation.upsert({
    where: {
      tenantId_channelId_externalThreadId: {
        tenantId,
        channelId,
        externalThreadId: message.conversationId,
      },
    },
    create: {
      tenantId,
      channelId,
      externalThreadId: message.conversationId,
      contactId: contact.id,
      status: "needs_reply",
      lastMessageAt: receivedAt,
    },
    update: { contactId: contact.id },
  })

  const direction = fromEmail === myEmail ? "outbound" : "inbound"
  const values = {
    conversationId: conversation.id,
    direction,
    fromE164: message.from.emailAddress.address,
    toE164: message.toRecipients.map((recipient) => recipient.emailAddress.address).join(", "),
    body: bodyText(message) || `[${message.subject || "No subject"}]`,
    subject: message.subject || null,
    isRead: message.isRead ?? false,
    createdAt: receivedAt,
  } as const

  await prisma.message.upsert({
    where: { providerMessageId: `outlook_${message.id}` },
    create: { ...values, providerMessageId: `outlook_${message.id}` },
    update: values,
  })

  if (!(conversation.lastMessageAt instanceof Date) || receivedAt > conversation.lastMessageAt) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: receivedAt },
    })
  }
  affectedConversationIds.add(conversation.id)
  return true
}

export async function runOutlookDeltaSync({
  channelId,
  tenantId,
  requestedMode,
  maxPages = DEFAULT_MAX_PAGES,
}: {
  channelId: string
  tenantId: string
  requestedMode: RequestedSyncMode
  maxPages?: number
}): Promise<OutlookDeltaSyncResult> {
  const channel = await prisma.channel.findUnique({ where: { id: channelId } })
  if (
    !channel ||
    channel.tenantId !== tenantId ||
    channel.provider !== "microsoft" ||
    !channel.emailAddress
  ) {
    throw new Error("Outlook channel not found")
  }

  const now = new Date()
  const leaseId = randomUUID()
  const mode = `${requestedMode}_delta` as const
  const claimed = await prisma.outlookCredential.updateMany({
    where: {
      channelId,
      OR: [{ syncLockExpiresAt: null }, { syncLockExpiresAt: { lt: now } }],
    },
    data: {
      syncLeaseId: leaseId,
      syncLockExpiresAt: new Date(now.getTime() + SYNC_LEASE_MS),
      lastSyncMode: mode,
      lastSyncStatus: "running",
      lastSyncError: null,
    },
  })
  if (claimed.count === 0) {
    return { ok: true, channelId, skipped: "sync_in_progress" }
  }

  let synced = 0
  let deleted = 0
  let pages = 0
  let hasMore = false

  try {
    const credential = await prisma.outlookCredential.findUnique({ where: { channelId } })
    if (!credential) throw new Error("Outlook credential not found")

    const token = await getOutlookAccessToken(channelId)
    let pagePath = credential.deltaLinkEncrypted
      ? decryptString(credential.deltaLinkEncrypted)
      : initialDeltaPath()
    const affectedConversationIds = new Set<string>()

    while (pages < Math.max(1, maxPages)) {
      let page: GraphDeltaPage
      try {
        page = await graphGet<GraphDeltaPage>(pagePath, token, {
          Prefer: "odata.maxpagesize=50",
        })
      } catch (error) {
        if (error instanceof MicrosoftGraphError && error.status === 410) {
          await prisma.outlookCredential.updateMany({
            where: { channelId, syncLeaseId: leaseId },
            data: {
              deltaLinkEncrypted: null,
              lastSyncStatus: "cursor_reset",
              lastSyncError: null,
              syncLeaseId: null,
              syncLockExpiresAt: null,
            },
          })
          return { ok: true, channelId, skipped: "cursor_reset" }
        }
        throw error
      }

      for (const item of page.value) {
        if (isRemovedMessage(item)) {
          if (await applyRemovedMessage(item.id, affectedConversationIds)) deleted++
          continue
        }
        if (
          await applyLiveMessage({
            message: item,
            channelId,
            tenantId,
            myEmail: channel.emailAddress.toLowerCase(),
            affectedConversationIds,
          })
        ) {
          synced++
        }
      }

      pages++
      const nextLink = page["@odata.nextLink"]
      const deltaLink = page["@odata.deltaLink"]
      if (nextLink) {
        await persistCursor(channelId, leaseId, nextLink)
        pagePath = nextLink
        hasMore = pages >= Math.max(1, maxPages)
        if (hasMore) break
        continue
      }
      if (!deltaLink) throw new Error("Microsoft Graph delta response missing cursor")
      await persistCursor(channelId, leaseId, deltaLink)
      hasMore = false
      break
    }

    await Promise.all(
      [...affectedConversationIds].map((conversationId) =>
        syncConversationWorkItems({ tenantId, conversationId }).catch(() => undefined)
      )
    )

    const released = await prisma.outlookCredential.updateMany({
      where: { channelId, syncLeaseId: leaseId },
      data: {
        ...(hasMore ? {} : { lastSyncedAt: new Date() }),
        lastSyncMode: mode,
        lastSyncStatus: hasMore ? "partial" : "success",
        lastSyncError: null,
        syncLeaseId: null,
        syncLockExpiresAt: null,
      },
    })
    if (released.count !== 1) throw new Error("Outlook sync lease lost")

    return { ok: true, channelId, synced, deleted, pages, hasMore, mode }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Outlook sync error"
    await prisma.outlookCredential
      .updateMany({
        where: { channelId, syncLeaseId: leaseId },
        data: {
          lastSyncMode: mode,
          lastSyncStatus: "error",
          lastSyncError: message,
          syncLeaseId: null,
          syncLockExpiresAt: null,
        },
      })
      .catch(() => {})
    throw error
  }
}
