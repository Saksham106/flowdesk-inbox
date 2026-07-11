import { getWritebackAdapter } from "@/lib/email/writeback-adapter"
import { supportsMailboxWriteback } from "@/lib/email/provider-support"

type ArchivableConversation = {
  id: string
  channelId: string
  externalThreadId: string | null
  channel: { provider: string } | null
}

export type ProviderMailboxArchiveResult = {
  /** Conversation ids successfully archived/restored in the provider's mailbox. */
  archived: string[]
  /** Conversation ids whose provider archive/restore call failed (still closed/restored locally). */
  failed: string[]
}

/** Conversations backed by a writeback-capable provider (Gmail, Outlook) with a thread we can act on. */
export function archivableInProviderMailbox<T extends ArchivableConversation>(convs: T[]): T[] {
  return convs.filter((c) => supportsMailboxWriteback(c.channel?.provider) && !!c.externalThreadId)
}

/**
 * Removes each conversation's thread from the provider mailbox's inbox (Gmail:
 * drop the INBOX label; Outlook: move out of the Inbox folder) so a Clean
 * Inbox batch actually leaves the user's mailbox, not just the FlowDesk row.
 * Per-thread isolated and best-effort: one provider failure never rejects the
 * batch, and conversations on providers without mailbox writeback support are
 * simply skipped (they are already closed locally by the caller).
 *
 * Outlook wrinkle: moving a conversation out of the Inbox folder means the
 * inbox-scoped delta feed later reports it `@removed`. That's expected and
 * harmless — the caller already closed the conversation locally before this
 * runs, and a Clean Inbox undo re-syncs the conversation back in.
 */
export async function archiveConversationsInProviderMailbox(
  convs: ArchivableConversation[]
): Promise<ProviderMailboxArchiveResult> {
  const targets = archivableInProviderMailbox(convs)
  const archived: string[] = []
  const failed: string[] = []

  await Promise.all(
    targets.map(async (conv) => {
      const adapter = getWritebackAdapter(conv.channel?.provider)
      if (!adapter) return
      try {
        await adapter.archiveConversation(conv.channelId, conv.externalThreadId as string)
        archived.push(conv.id)
      } catch (err) {
        failed.push(conv.id)
        console.error(`[clean-inbox] mailbox archive failed for ${conv.id}:`, err)
      }
    })
  )

  return { archived, failed }
}

/**
 * Re-adds each conversation's thread to the provider mailbox's inbox (Gmail:
 * re-add INBOX; Outlook: move back into the Inbox folder) — the mailbox side
 * of a Clean Inbox undo. Same best-effort, per-thread-isolated contract as the
 * archive path. Restoring a thread that is already in the inbox is a harmless
 * no-op, so this is safe to call for every conversation in the restored batch.
 */
export async function restoreConversationsInProviderMailbox(
  convs: ArchivableConversation[]
): Promise<ProviderMailboxArchiveResult> {
  const targets = archivableInProviderMailbox(convs)
  const archived: string[] = []
  const failed: string[] = []

  await Promise.all(
    targets.map(async (conv) => {
      const adapter = getWritebackAdapter(conv.channel?.provider)
      if (!adapter) return
      try {
        await adapter.restoreConversation(conv.channelId, conv.externalThreadId as string)
        archived.push(conv.id)
      } catch (err) {
        failed.push(conv.id)
        console.error(`[clean-inbox] mailbox restore failed for ${conv.id}:`, err)
      }
    })
  )

  return { archived, failed }
}
