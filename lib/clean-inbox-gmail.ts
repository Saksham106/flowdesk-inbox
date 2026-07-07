import { archiveGmailThread, unarchiveGmailThread } from "@/lib/google"

type ArchivableConversation = {
  id: string
  channelId: string
  externalThreadId: string | null
  channel: { provider: string } | null
}

export type GmailArchiveResult = {
  /** Conversation ids successfully archived (INBOX removed) in Gmail. */
  archived: string[]
  /** Conversation ids whose Gmail archive call failed (still closed locally). */
  failed: string[]
}

/** Google-backed conversations that have a thread we can archive. */
export function archivableInGmail<T extends ArchivableConversation>(convs: T[]): T[] {
  return convs.filter((c) => c.channel?.provider === "google" && !!c.externalThreadId)
}

/**
 * Removes the INBOX label from each Google-backed thread so a Clean Inbox batch
 * actually leaves the user's Gmail. Per-thread isolated and best-effort: one
 * provider failure never rejects the batch, and non-Gmail conversations are
 * simply skipped (they are already closed locally by the caller).
 */
export async function archiveConversationsInGmail(
  convs: ArchivableConversation[]
): Promise<GmailArchiveResult> {
  const targets = archivableInGmail(convs)
  const archived: string[] = []
  const failed: string[] = []

  await Promise.all(
    targets.map(async (conv) => {
      try {
        await archiveGmailThread(conv.channelId, conv.externalThreadId as string)
        archived.push(conv.id)
      } catch (err) {
        failed.push(conv.id)
        console.error(`[clean-inbox] Gmail archive failed for ${conv.id}:`, err)
      }
    })
  )

  return { archived, failed }
}

/**
 * Re-adds INBOX to each Google-backed thread — the Gmail side of a Clean Inbox
 * undo. Same best-effort, per-thread-isolated contract as the archive path.
 * Re-adding INBOX to a thread that still has it is a harmless no-op, so this is
 * safe to call for every Google conversation in the restored batch.
 */
export async function restoreConversationsInGmail(
  convs: ArchivableConversation[]
): Promise<GmailArchiveResult> {
  const targets = archivableInGmail(convs)
  const archived: string[] = []
  const failed: string[] = []

  await Promise.all(
    targets.map(async (conv) => {
      try {
        await unarchiveGmailThread(conv.channelId, conv.externalThreadId as string)
        archived.push(conv.id)
      } catch (err) {
        failed.push(conv.id)
        console.error(`[clean-inbox] Gmail unarchive failed for ${conv.id}:`, err)
      }
    })
  )

  return { archived, failed }
}
