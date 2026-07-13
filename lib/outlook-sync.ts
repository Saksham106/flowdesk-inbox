import { randomUUID } from "crypto"

import { clearGmailLabelOverride } from "@/lib/agent/gmail-label-feedback"
import {
  applyOutlookCategoryFeedback,
  type OutlookProjectionSnapshot,
} from "@/lib/agent/outlook-category-feedback"
import { syncConversationWorkItems } from "@/lib/agent/work-item-sync"
import { decryptString, encryptString } from "@/lib/crypto"
import { normalizeFlowDeskLabelPayload } from "@/lib/email-labels"
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
  "categories",
].join(",")

type FeedbackCandidate = { conversationId: string; categories: string[] }

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

// Pre-run view of a conversation's apply_labels projection job, read BEFORE
// work-item sync can rewrite it during this run. Null when FlowDesk never
// projected labels for the thread or the payload is unreadable — either way
// there is nothing trustworthy to diff a user edit against.
async function snapshotProjectionJob(
  conversationId: string
): Promise<OutlookProjectionSnapshot | null> {
  const job = await prisma.emailWritebackQueue.findUnique({
    where: { conversationId_action: { conversationId, action: "apply_labels" } },
    select: { status: true, providerMessageIdsJson: true },
  })
  if (!job) return null
  const payload = normalizeFlowDeskLabelPayload(job.providerMessageIdsJson)
  if (!payload) return null
  return {
    settled: job.status !== "pending" && job.status !== "processing",
    labels: payload.labels,
  }
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
  feedbackCandidates,
}: {
  message: GraphMessage
  channelId: string
  tenantId: string
  myEmail: string
  affectedConversationIds: Set<string>
  feedbackCandidates: Map<string, FeedbackCandidate>
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
  const providerMessageId = `outlook_${message.id}`
  // Distinguish a genuine user category edit (on a message we already had) from
  // categories set by FlowDesk's own projection on first ingest: only messages
  // that already existed can carry a user edit. Cheap existence probe before the
  // upsert, mirroring how applyRemovedMessage reads by providerMessageId.
  const existed = !!(await prisma.message.findUnique({
    where: { providerMessageId },
    select: { id: true },
  }))
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

  // Only isRead can genuinely change on a message we already ingested — the
  // delta feed re-delivers the whole message for category/read edits, and
  // rewriting the full row (body included) made every such touch a dead-tuple
  // + WAL churn write. Gmail's equivalent path updates read/label state only.
  await prisma.message.upsert({
    where: { providerMessageId },
    create: { ...values, providerMessageId },
    update: { isRead: values.isRead },
  })

  // Recompute the provider-unread flag after the upsert. `gmailUnread`, despite
  // the name, is the generic "unread in the provider mailbox" flag shared by
  // Gmail and Outlook: true when any inbound message is still unread. Folded
  // into the lastMessageAt bump so a live message costs a single conversation
  // write.
  const unreadInbound = await prisma.message.count({
    where: { conversationId: conversation.id, direction: "inbound", isRead: false },
  })
  const bumpsLastMessage =
    !(conversation.lastMessageAt instanceof Date) || receivedAt > conversation.lastMessageAt
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      gmailUnread: unreadInbound > 0,
      ...(bumpsLastMessage ? { lastMessageAt: receivedAt } : {}),
    },
  })

  // Only pre-existing inbound messages can reflect a user's manual category
  // edit; brand-new messages get their categories from FlowDesk's projection.
  // Last write per conversation wins.
  if (existed && direction === "inbound") {
    feedbackCandidates.set(conversation.id, {
      conversationId: conversation.id,
      categories: message.categories ?? [],
    })
  } else if (!existed && direction === "inbound") {
    // Mirror Gmail (lib/google.ts): a genuinely NEW inbound message resets the
    // thread context, so lift any user-edit label hold that would otherwise
    // freeze projection forever. Best-effort; never breaks the sync run.
    clearGmailLabelOverride({ tenantId, conversationId: conversation.id }).catch((err) => {
      console.warn("Failed to clear label override after Outlook inbound message", {
        tenantId,
        conversationId: conversation.id,
        message: err instanceof Error ? err.message : "Unknown error",
      })
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
    const feedbackCandidates = new Map<string, FeedbackCandidate>()

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
            feedbackCandidates,
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

    // Snapshot each feedback candidate's apply_labels projection BEFORE
    // work-item sync runs: re-projection during this run always rewrites the
    // job (queueFlowDeskLabelWriteback's upsert replaces the payload), so a
    // post-run read would diff the delta's category snapshot against a payload
    // NEWER than it — fabricating phantom "user removed X" corrections while
    // never seeing the edit itself. Diffing against the pre-run payload — what
    // FlowDesk had actually projected when the user edited — kills the phantom
    // and keeps genuine edits learnable in the same run.
    const priorProjections = new Map<string, OutlookProjectionSnapshot | null>()
    for (const conversationId of feedbackCandidates.keys()) {
      priorProjections.set(
        conversationId,
        await snapshotProjectionJob(conversationId).catch(() => null)
      )
    }

    await Promise.all(
      [...affectedConversationIds].map((conversationId) =>
        syncConversationWorkItems({ tenantId, conversationId }).catch(() => undefined)
      )
    )

    // Learn user category edits after work-item sync has settled the projection.
    // Failures are swallowed so feedback never breaks the sync run itself.
    for (const item of feedbackCandidates.values()) {
      await applyOutlookCategoryFeedback({
        tenantId,
        conversationId: item.conversationId,
        messageCategories: item.categories,
        priorJob: priorProjections.get(item.conversationId) ?? null,
      }).catch(() => undefined)
    }

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
