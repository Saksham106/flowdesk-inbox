import {
  applyFlowDeskLabelsToGmailThread,
  archiveGmailThread,
  createGmailDraftForThread,
  deleteGmailDraft,
  markGmailThreadRead,
  ensureFlowDeskLabels,
  trashGmailThread,
  unarchiveGmailThread,
} from "@/lib/google"
import {
  applyFlowDeskCategoriesToConversation,
  archiveOutlookConversation,
  createOutlookDraftReply,
  deleteOutlookDraft,
  ensureFlowDeskCategories,
  markOutlookConversationRead,
  restoreOutlookConversation,
  trashOutlookConversation,
} from "@/lib/outlook-mailbox"
import type { FlowDeskLabelName } from "@/lib/gmail-labels"

export type EmailWritebackAdapter = {
  provider: "google" | "microsoft"
  auditPrefix: "gmail" | "outlook"
  ensureLabels(channelId: string): Promise<void>
  applyLabels(channelId: string, externalThreadId: string, labels: FlowDeskLabelName[]): Promise<void>
  markConversationRead(
    channelId: string,
    providerMessageIds: string[],
    context: { tenantId: string; conversationId: string }
  ): Promise<void>
  archiveConversation(channelId: string, externalThreadId: string): Promise<void>
  restoreConversation(channelId: string, externalThreadId: string): Promise<void>
  trashConversation(channelId: string, externalThreadId: string): Promise<void>
  createDraftReply(
    channelId: string,
    input: { externalThreadId: string; channelEmail: string; body: string }
  ): Promise<string>
  deleteDraft(channelId: string, draftId: string): Promise<void>
}

const googleAdapter: EmailWritebackAdapter = {
  provider: "google",
  auditPrefix: "gmail",
  ensureLabels: (channelId) => ensureFlowDeskLabels(channelId),
  applyLabels: (channelId, threadId, labels) =>
    applyFlowDeskLabelsToGmailThread(channelId, threadId, labels),
  markConversationRead: (channelId, ids, context) => markGmailThreadRead(channelId, ids, context),
  archiveConversation: (channelId, threadId) => archiveGmailThread(channelId, threadId),
  restoreConversation: (channelId, threadId) => unarchiveGmailThread(channelId, threadId),
  trashConversation: (channelId, threadId) => trashGmailThread(channelId, threadId),
  createDraftReply: (channelId, input) => createGmailDraftForThread(channelId, input),
  deleteDraft: (channelId, draftId) => deleteGmailDraft(channelId, draftId),
}

const microsoftAdapter: EmailWritebackAdapter = {
  provider: "microsoft",
  auditPrefix: "outlook",
  ensureLabels: (channelId) => ensureFlowDeskCategories(channelId),
  applyLabels: (channelId, threadId, labels) =>
    applyFlowDeskCategoriesToConversation(channelId, threadId, labels),
  markConversationRead: (channelId, ids) => markOutlookConversationRead(channelId, ids),
  archiveConversation: (channelId, threadId) => archiveOutlookConversation(channelId, threadId),
  restoreConversation: (channelId, threadId) => restoreOutlookConversation(channelId, threadId),
  trashConversation: (channelId, threadId) => trashOutlookConversation(channelId, threadId),
  createDraftReply: (channelId, input) =>
    createOutlookDraftReply(channelId, { externalThreadId: input.externalThreadId, body: input.body }),
  deleteDraft: (channelId, draftId) => deleteOutlookDraft(channelId, draftId),
}

export function getWritebackAdapter(
  provider: string | null | undefined
): EmailWritebackAdapter | null {
  if (provider === "google") return googleAdapter
  if (provider === "microsoft") return microsoftAdapter
  return null
}
