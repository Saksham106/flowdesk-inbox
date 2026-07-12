import {
  getOutlookAccessToken,
  graphGet,
  graphRequest,
  MicrosoftGraphError,
} from "@/lib/microsoft"
import {
  FLOWDESK_LABEL_NAMES,
  isFlowDeskLabelName,
  type FlowDeskLabelName,
} from "@/lib/email-labels"

// Outlook has no thread-level mutation API: every operation fans out over the
// conversation's messages. Cap the fan-out so a 500-message newsletter thread
// can't turn one writeback job into 500 Graph calls.
export const OUTLOOK_CONVERSATION_MESSAGE_CAP = 20

// Graph master categories only take preset colors (preset0–preset24), not hex.
// Nearest-preset mapping of FLOWDESK_GMAIL_LABEL_COLORS in lib/google.ts.
const FLOWDESK_CATEGORY_PRESETS: Record<FlowDeskLabelName, string> = {
  "Needs Reply": "preset0",   // red (Gmail coral)
  "Needs Action": "preset1",  // orange
  "Waiting On": "preset7",    // blue
  "Read Later": "preset9",    // cranberry (Gmail rose)
  Handled: "preset12",        // gray
  Autodrafted: "preset8",     // purple
  Newsletter: "preset3",      // yellow
  Marketing: "preset15",      // dark red
  Notification: "preset5",    // teal (Gmail cyan)
  Calendar: "preset4",        // green
}

const FLOWDESK_CATEGORY_SET = new Set<string>(FLOWDESK_LABEL_NAMES)

type MasterCategory = { id: string; displayName: string; color?: string }
type ConversationMessage = { id: string; categories?: string[]; receivedDateTime?: string }

function graphIdFromProviderMessageId(providerMessageId: string): string | null {
  return providerMessageId.startsWith("outlook_") ? providerMessageId.slice("outlook_".length) : null
}

async function listConversationMessages(
  token: string,
  externalThreadId: string,
  extra: { draftsOnly?: boolean } = {}
): Promise<ConversationMessage[]> {
  // No $orderby here: Graph rejects $filter-on-conversationId combined with
  // $orderby on a property absent from the filter (400 InefficientFilter).
  // Sort client-side instead — the page is capped, so this is cheap.
  const params = new URLSearchParams({
    $filter: `conversationId eq '${externalThreadId.replace(/'/g, "''")}' and isDraft eq ${extra.draftsOnly ? "true" : "false"}`,
    $top: String(OUTLOOK_CONVERSATION_MESSAGE_CAP),
    $select: "id,categories,receivedDateTime",
  })
  const page = await graphGet<{ value: ConversationMessage[] }>(`/messages?${params}`, token)
  return (page.value ?? []).sort((left, right) =>
    (right.receivedDateTime ?? "").localeCompare(left.receivedDateTime ?? "")
  )
}

// Adopts existing same-named categories (never duplicates, never deletes user
// categories); creates missing ones with the nearest preset color. A 409 from
// a concurrent create is success — the category exists.
export async function ensureFlowDeskCategories(channelId: string): Promise<void> {
  const token = await getOutlookAccessToken(channelId)
  const existing = await graphGet<{ value: MasterCategory[] }>("/outlook/masterCategories", token)
  const have = new Set((existing.value ?? []).map((category) => category.displayName))
  for (const name of FLOWDESK_LABEL_NAMES) {
    if (have.has(name)) continue
    try {
      await graphRequest("/me/outlook/masterCategories", token, {
        method: "POST",
        body: { displayName: name, color: FLOWDESK_CATEGORY_PRESETS[name] },
      })
    } catch (err) {
      if (err instanceof MicrosoftGraphError && err.status === 409) continue
      throw err
    }
  }
}

// The Outlook analog of applyFlowDeskLabelsToGmailThread: desired FlowDesk
// categories replace the current FlowDesk set on each message; the user's own
// categories are always preserved. An empty `labels` array means "remove all
// FlowDesk categories". 404 on a single message (user moved/deleted it) is
// skipped, not fatal.
export async function applyFlowDeskCategoriesToConversation(
  channelId: string,
  externalThreadId: string,
  labels: FlowDeskLabelName[]
): Promise<void> {
  const desired = Array.from(new Set(labels.filter(isFlowDeskLabelName)))
  await ensureFlowDeskCategories(channelId)
  const token = await getOutlookAccessToken(channelId)
  const messages = await listConversationMessages(token, externalThreadId)

  for (const message of messages) {
    const current = message.categories ?? []
    const next = [
      ...current.filter((category) => !FLOWDESK_CATEGORY_SET.has(category)),
      ...desired,
    ]
    const unchanged =
      next.length === current.length && next.every((category) => current.includes(category))
    if (unchanged) continue
    try {
      await graphRequest(`/me/messages/${message.id}`, token, {
        method: "PATCH",
        body: { categories: next },
      })
    } catch (err) {
      if (err instanceof MicrosoftGraphError && err.status === 404) continue
      throw err
    }
  }
}

export async function markOutlookConversationRead(
  channelId: string,
  providerMessageIds: string[]
): Promise<void> {
  const token = await getOutlookAccessToken(channelId)
  for (const providerMessageId of providerMessageIds) {
    const id = graphIdFromProviderMessageId(providerMessageId)
    if (!id) continue
    try {
      await graphRequest(`/me/messages/${id}`, token, { method: "PATCH", body: { isRead: true } })
    } catch (err) {
      if (err instanceof MicrosoftGraphError && err.status === 404) continue
      throw err
    }
  }
}

// Moving a message out of the inbox surfaces as @removed in the inbox-scoped
// delta feed, so the local Message rows disappear on the next sync — the
// conversation is already closed locally by every archive caller, matching
// the "leaves the inbox" contract. Restore looks the messages up by
// conversationId in the target folder (message ids change on move, so we
// never try to remember them).
async function moveConversationMessages(
  channelId: string,
  externalThreadId: string,
  fromFolder: "inbox" | "archive",
  destinationId: string
): Promise<void> {
  const token = await getOutlookAccessToken(channelId)
  const params = new URLSearchParams({
    $filter: `conversationId eq '${externalThreadId.replace(/'/g, "''")}'`,
    $top: String(OUTLOOK_CONVERSATION_MESSAGE_CAP),
    $select: "id",
  })
  const page = await graphGet<{ value: Array<{ id: string }> }>(
    `/mailFolders('${fromFolder}')/messages?${params}`,
    token
  )
  for (const message of page.value ?? []) {
    try {
      await graphRequest(`/me/messages/${message.id}/move`, token, {
        method: "POST",
        body: { destinationId },
      })
    } catch (err) {
      if (err instanceof MicrosoftGraphError && err.status === 404) continue
      throw err
    }
  }
}

export async function archiveOutlookConversation(channelId: string, externalThreadId: string): Promise<void> {
  await moveConversationMessages(channelId, externalThreadId, "inbox", "archive")
}

export async function restoreOutlookConversation(channelId: string, externalThreadId: string): Promise<void> {
  await moveConversationMessages(channelId, externalThreadId, "archive", "inbox")
}

export async function trashOutlookConversation(channelId: string, externalThreadId: string): Promise<void> {
  await moveConversationMessages(channelId, externalThreadId, "inbox", "deleteditems")
}

// Reply-draft parity with createGmailDraftForThread: creates a Graph reply
// draft on the latest non-draft message in the conversation (preserves
// threading/subject/recipients), then patches in the body. The draft sits in
// the user's Drafts folder until they send or FlowDesk withdraws it.
export async function createOutlookDraftReply(
  channelId: string,
  input: { externalThreadId: string; body: string }
): Promise<string> {
  const token = await getOutlookAccessToken(channelId)
  // $orderby with a conversationId filter triggers Graph's InefficientFilter
  // rejection, so fetch the capped page and pick the newest client-side.
  const params = new URLSearchParams({
    $filter: `conversationId eq '${input.externalThreadId.replace(/'/g, "''")}' and isDraft eq false`,
    $top: String(OUTLOOK_CONVERSATION_MESSAGE_CAP),
    $select: "id,receivedDateTime",
  })
  const latest = await graphGet<{ value: Array<{ id: string; receivedDateTime?: string }> }>(
    `/messages?${params}`,
    token
  )
  const lastMessageId = (latest.value ?? [])
    .sort((left, right) => (right.receivedDateTime ?? "").localeCompare(left.receivedDateTime ?? ""))[0]?.id
  if (!lastMessageId) throw new Error("No Outlook message found to draft a reply to")

  const draft = await graphRequest<{ id: string }>(
    `/me/messages/${lastMessageId}/createReply`,
    token,
    { method: "POST" }
  )
  await graphRequest(`/me/messages/${draft.id}`, token, {
    method: "PATCH",
    body: { body: { contentType: "Text", content: input.body } },
  })
  return draft.id
}

export async function deleteOutlookDraft(channelId: string, draftId: string): Promise<void> {
  const token = await getOutlookAccessToken(channelId)
  try {
    await graphRequest(`/me/messages/${draftId}`, token, { method: "DELETE" })
  } catch (err) {
    if (err instanceof MicrosoftGraphError && err.status === 404) return
    throw err
  }
}
