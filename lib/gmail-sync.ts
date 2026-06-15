import { prisma } from "@/lib/prisma"
import {
  fetchLatestHistoryId,
  syncGmailChannel,
  syncGmailChannelIncremental,
  watchGmailChannel,
} from "@/lib/google"

type RequestedSyncMode = "manual" | "auto" | "push" | "oauth_callback"
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
        lastSyncedAt: new Date(),
        lastSyncMode: storedMode,
        lastSyncStatus: "success",
        lastSyncError: null,
        syncLockExpiresAt: null,
      },
    })

    return { ok: true, channelId, synced, historyId, mode: storedMode }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown sync error"
    await prisma.gmailCredential
      .update({
        where: { channelId },
        data: {
          lastSyncMode: storedMode,
          lastSyncStatus: "error",
          lastSyncError: message,
          syncLockExpiresAt: null,
        },
      })
      .catch(() => {})
    throw err
  }
}

export async function processGmailPushNotification(payload: unknown): Promise<GmailSyncResult | { ok: true; skipped: string }> {
  const envelope = payload as { message?: { data?: string } } | null
  const encoded = envelope?.message?.data
  if (!encoded) throw new Error("Missing Pub/Sub message data")

  const notification = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
    emailAddress?: string
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

  return runGmailSync({
    channelId: channel.id,
    tenantId: channel.tenantId,
    requestedMode: "push",
    incremental: Boolean(channel.gmailCredential?.historyId),
    ensureWatch: Boolean(process.env.GMAIL_PUSH_TOPIC),
  })
}
