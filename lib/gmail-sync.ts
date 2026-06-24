import { prisma } from "@/lib/prisma"
import {
  fetchLatestHistoryId,
  syncGmailChannel,
  syncGmailChannelIncremental,
  watchGmailChannel,
} from "@/lib/google"

type RequestedSyncMode = "manual" | "auto" | "push" | "oauth_callback"

export class GmailAuthError extends Error {
  readonly isAuthError = true as const
  constructor(message: string) {
    super(message)
    this.name = "GmailAuthError"
  }
}

function isInvalidGrantError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false
  const candidate = err as {
    message?: unknown
    response?: { data?: unknown; status?: unknown }
  }
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : ""
  if (message.includes("invalid_grant")) return true
  if (message.includes("token has been expired") || message.includes("token has been revoked")) return true
  const data = candidate.response?.data
  if (typeof data === "object" && data !== null) {
    const errorField = (data as { error?: unknown }).error
    if (errorField === "invalid_grant") return true
  }
  return false
}
type StoredSyncMode =
  | "manual_full"
  | "manual_incremental"
  | "auto_full"
  | "auto_incremental"
  | "push_full"
  | "push_incremental"
  | "oauth_callback_full"
  | "history_fallback"

type GmailSyncResult = {
  ok: true
  channelId: string
  synced?: number
  historyId?: string | null
  mode?: StoredSyncMode
  skipped?: "sync_in_progress"
}

const SYNC_LOCK_MS = 2 * 60 * 1000

function modeName(requestedMode: RequestedSyncMode, incremental: boolean): StoredSyncMode {
  if (requestedMode === "oauth_callback") return "oauth_callback_full"
  return `${requestedMode}_${incremental ? "incremental" : "full"}` as StoredSyncMode
}

function isInvalidHistoryIdError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false
  const candidate = err as {
    code?: unknown
    status?: unknown
    response?: { status?: unknown; data?: unknown }
    message?: unknown
  }
  const status = candidate.code ?? candidate.status ?? candidate.response?.status
  if (status === 404 || status === "404") return true
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : ""
  return message.includes("historyid") || message.includes("start history")
}

async function ensureLatestHistoryId(channelId: string): Promise<string | null> {
  const latestHistoryId = await fetchLatestHistoryId(channelId)
  if (latestHistoryId) {
    await prisma.gmailCredential.update({
      where: { channelId },
      data: { historyId: latestHistoryId },
    })
  }
  return latestHistoryId
}

export async function runGmailSync({
  channelId,
  tenantId,
  requestedMode,
  incremental,
  ensureWatch = false,
}: {
  channelId: string
  tenantId: string
  requestedMode: RequestedSyncMode
  incremental: boolean
  ensureWatch?: boolean
}): Promise<GmailSyncResult> {
  const lockUntil = new Date(Date.now() + SYNC_LOCK_MS)
  const lock = await prisma.gmailCredential.updateMany({
    where: {
      channelId,
      OR: [{ syncLockExpiresAt: null }, { syncLockExpiresAt: { lt: new Date() } }],
    },
    data: {
      syncLockExpiresAt: lockUntil,
      lastSyncMode: modeName(requestedMode, incremental),
      lastSyncStatus: "running",
    },
  })

  if (lock.count === 0) {
    return { ok: true, channelId, skipped: "sync_in_progress" }
  }

  let storedMode = modeName(requestedMode, incremental)
  let synced = 0
  let historyId: string | null = null
  let historyFallbackAt: Date | null = null

  try {
    if (incremental) {
      const cred = await prisma.gmailCredential.findUnique({ where: { channelId } })
      if (cred?.historyId) {
        try {
          const result = await syncGmailChannelIncremental(channelId, tenantId)
          synced = result.synced
          historyId = result.newHistoryId ?? null
        } catch (err) {
          if (!isInvalidHistoryIdError(err)) throw err
          console.warn("Gmail history cursor expired; running recent sync fallback", {
            tenantId,
            channelId,
            message: err instanceof Error ? err.message : "Unknown Gmail history error",
          })
          storedMode = "history_fallback"
          historyFallbackAt = new Date()
          synced = await syncGmailChannel(channelId, tenantId)
          historyId = await ensureLatestHistoryId(channelId)
        }
      } else {
        storedMode = modeName(requestedMode, false)
        synced = await syncGmailChannel(channelId, tenantId)
        historyId = await ensureLatestHistoryId(channelId)
      }
    } else {
      synced = await syncGmailChannel(channelId, tenantId)
      historyId = await ensureLatestHistoryId(channelId)
    }

    if (ensureWatch && process.env.GMAIL_PUSH_TOPIC) {
      try {
        const watch = await watchGmailChannel(channelId, process.env.GMAIL_PUSH_TOPIC)
        historyId = watch.historyId
      } catch (err) {
        console.warn("Failed to setup Gmail watch for channel", {
          tenantId,
          channelId,
          message: err instanceof Error ? err.message : "Unknown watch setup error",
        })
      }
    }

    await prisma.gmailCredential.update({
      where: { channelId },
      data: {
        ...(historyId ? { historyId } : {}),
        ...(historyFallbackAt ? { lastHistoryFallbackAt: historyFallbackAt } : {}),
        lastSyncedAt: new Date(),
        lastSyncMode: storedMode,
        lastSyncStatus: "success",
        lastSyncError: null,
        syncLockExpiresAt: null,
      },
    })

    return { ok: true, channelId, synced, historyId, mode: storedMode }
  } catch (err) {
    const isAuthError = isInvalidGrantError(err)
    const message = isAuthError
      ? "Gmail authorization expired — please reconnect your Gmail account"
      : err instanceof Error ? err.message : "Unknown sync error"
    await prisma.gmailCredential
      .update({
        where: { channelId },
        data: {
          lastSyncMode: storedMode,
          lastSyncStatus: isAuthError ? "needs_reauth" : "error",
          lastSyncError: message,
          syncLockExpiresAt: null,
        },
      })
      .catch(() => {})
    throw isAuthError ? new GmailAuthError(message) : err
  }
}

export async function processGmailPushNotification(payload: unknown): Promise<GmailSyncResult | { ok: true; skipped: string; failed?: true; error?: string }> {
  const envelope = payload as { message?: { data?: string; messageId?: string } } | null
  const encoded = envelope?.message?.data
  if (!encoded) throw new Error("Missing Pub/Sub message data")
  const messageId = envelope?.message?.messageId ?? `legacy:${encoded}`

  const notification = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
    emailAddress?: string
    historyId?: string
  }
  const emailAddress = notification.emailAddress?.toLowerCase()
  if (!emailAddress) throw new Error("Missing Gmail notification emailAddress")

  const channel = await prisma.channel.findFirst({
    where: { emailAddress, type: "email", provider: "google" },
    include: { gmailCredential: true },
  })

  if (!channel) {
    return { ok: true, skipped: "channel_not_found" }
  }

  const existingEvent = await prisma.gmailPushEvent.findUnique({ where: { messageId } })
  if (existingEvent?.status === "completed") {
    return { ok: true, skipped: "push_already_completed" }
  }

  await prisma.gmailPushEvent.upsert({
    where: { messageId },
    create: {
      tenantId: channel.tenantId,
      channelId: channel.id,
      historyId: notification.historyId ?? null,
      messageId,
      status: "processing",
      error: null,
    },
    update: {
      status: "processing",
      error: null,
    },
  })

  try {
    const result = await runGmailSync({
      channelId: channel.id,
      tenantId: channel.tenantId,
      requestedMode: "push",
      incremental: Boolean(channel.gmailCredential?.historyId),
      ensureWatch: Boolean(process.env.GMAIL_PUSH_TOPIC),
    })

    if ("skipped" in result && result.skipped === "sync_in_progress") {
      await prisma.gmailPushEvent.update({
        where: { messageId },
        data: {
          status: "failed",
          error: "sync_in_progress",
          processedAt: new Date(),
        },
      })
      return result
    }

    await prisma.gmailPushEvent.update({
      where: { messageId },
      data: {
        status: "completed",
        error: null,
        processedAt: new Date(),
      },
    })

    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Gmail push processing error"
    await prisma.gmailPushEvent
      .update({
        where: { messageId },
        data: {
          status: "failed",
          error: message,
          processedAt: new Date(),
        },
      })
      .catch(() => {})
    return { ok: true, skipped: "push_processing_failed", failed: true, error: message }
  }
}
