import { stripHtmlToText } from "@/lib/email-body"

export type Message = {
  direction: "inbound" | "outbound" | string
  body: string
  createdAt: Date | string
}

export type ConversationSummary = {
  // High-level thread summary
  threadSummary: string
  // Key topics/themes discussed
  keyTopics: string[]
  // Open questions from the other party
  openQuestions: string[]
  // Promises/commitments made by us
  ourPromises: string[]
  // Recent activity (last 3 messages)
  recentActivity: string[]
  // Participant info
  participantCount: number
  messageCount: number
  inboundCount: number
  outboundCount: number
  // Time range
  firstMessageAt: Date
  lastMessageAt: Date
}

/**
 * Create a concise summary of a conversation thread for AI context.
 * Replaces sending raw messages (20 × 2500 chars = ~50k) with structured summary (~2k chars).
 */
export function summarizeConversation(messages: Message[]): ConversationSummary {
  if (messages.length === 0) {
    return emptySummary()
  }

  const sorted = [...messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )

  const inbound = sorted.filter((m) => m.direction === "inbound")
  const outbound = sorted.filter((m) => m.direction === "outbound")

  // Extract key topics from both directions
  const allText = sorted.map((m) => stripHtmlToText(m.body, 500)).join("\n")
  const keyTopics = extractKeyTopics(allText)

  // Find open questions (inbound messages ending with ?)
  const openQuestions = inbound
    .filter((m) => m.body.trim().endsWith("?"))
    .slice(-3)
    .map((m) => stripHtmlToText(m.body, 200))

  // Find our promises/commitments (outbound with promise patterns)
  const promisePattern = /\b(i['']ll|i will|we['']ll|we will|i['']m going to|i can|i['']ll send|i['']ll follow up|i['']ll get back)\b/i
  const ourPromises = outbound
    .filter((m) => promisePattern.test(m.body))
    .slice(-3)
    .map((m) => `• ${stripHtmlToText(m.body, 150)}`)

  // Recent activity (last 3 messages)
  const recentActivity = sorted
    .slice(-3)
    .map((m) => {
      const role = m.direction === "outbound" ? "You" : "They"
      return `${role}: ${stripHtmlToText(m.body, 120)}`
    })

  // Build thread summary
  const threadSummary = buildThreadSummary(inbound, outbound, keyTopics)

  return {
    threadSummary,
    keyTopics,
    openQuestions,
    ourPromises,
    recentActivity,
    participantCount: 2, // simplified
    messageCount: messages.length,
    inboundCount: inbound.length,
    outboundCount: outbound.length,
    firstMessageAt: new Date(sorted[0].createdAt),
    lastMessageAt: new Date(sorted[sorted.length - 1].createdAt),
  }
}

function emptySummary(): ConversationSummary {
  return {
    threadSummary: "No messages yet.",
    keyTopics: [],
    openQuestions: [],
    ourPromises: [],
    recentActivity: [],
    participantCount: 0,
    messageCount: 0,
    inboundCount: 0,
    outboundCount: 0,
    firstMessageAt: new Date(),
    lastMessageAt: new Date(),
  }
}

function extractKeyTopics(text: string): string[] {
  // Business/lead-related keywords
  const topicPatterns: Record<string, RegExp> = {
    pricing: /\b(pricing|price|cost|charge|quote|budget|fee|rate)\b/i,
    scheduling: /\b(schedule|book|meeting|demo|call|appointment|available|availability)\b/i,
    contract: /\b(contract|proposal|agreement|terms|sign|paperwork|document)\b/i,
    support: /\b(issue|problem|error|bug|help|support|trouble|not working|broken)\b/i,
    refund: /\b(refund|return|cancel|money back|dispute|chargeback)\b/i,
    onboarding: /\b(onboard|setup|install|configure|get started|first time)\b/i,
    integration: /\b(integrate|api|webhook|connect|sync|connect|zapier)\b/i,
    compliance: /\b(compliance|security|privacy|gdpr|hipaa|soc2|audit)\b/i,
    renewal: /\b(renew|renewal|subscription|annual|monthly|billing|invoice)\b/i,
    feature: /\b(feature|request|enhancement|add|improve|would like|suggestion)\b/i,
  }

  const topics: string[] = []
  for (const [topic, pattern] of Object.entries(topicPatterns)) {
    if (pattern.test(text)) {
      topics.push(topic)
    }
  }

  // Also extract proper nouns / company names (capitalized words 2+ chars)
  const properNouns = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) ?? []
  const uniqueProper = [...new Set(properNouns)].slice(0, 5)

  return [...new Set([...topics, ...uniqueProper])].slice(0, 8)
}

function buildThreadSummary(
  inbound: Message[],
  outbound: Message[],
  topics: string[]
): string {
  const parts: string[] = []

  if (topics.length > 0) {
    parts.push(`Topics: ${topics.join(", ")}`)
  }

  if (inbound.length > 0) {
    const lastInbound = inbound[inbound.length - 1]
    parts.push(`Last inbound (${lastInbound.createdAt}): "${stripHtmlToText(lastInbound.body, 100)}"`)
  }

  if (outbound.length > 0) {
    const lastOutbound = outbound[outbound.length - 1]
    parts.push(`Last outbound (${lastOutbound.createdAt}): "${stripHtmlToText(lastOutbound.body, 100)}"`)
  }

  if (parts.length === 0) {
    return "Empty conversation."
  }

  return `${inbound.length} inbound, ${outbound.length} outbound. ${parts.join("; ")}`
}

/**
 * Format the summary for inclusion in an AI prompt.
 * Keeps it concise (~1500 chars max).
 */
export function formatSummaryForPrompt(summary: ConversationSummary): string {
  const sections: string[] = []

  sections.push(`Thread Summary: ${summary.threadSummary}`)

  if (summary.keyTopics.length > 0) {
    sections.push(`Key Topics: ${summary.keyTopics.join(", ")}`)
  }

  if (summary.openQuestions.length > 0) {
    sections.push(`Open Questions:\n${summary.openQuestions.map((q) => `- ${q}`).join("\n")}`)
  }

  if (summary.ourPromises.length > 0) {
    sections.push(`Our Promises:\n${summary.ourPromises.join("\n")}`)
  }

  if (summary.recentActivity.length > 0) {
    sections.push(`Recent Activity:\n${summary.recentActivity.join("\n")}`)
  }

  return sections.join("\n\n")
}

/**
 * Select most relevant knowledge documents for a conversation.
 * Uses keyword overlap between conversation topics and document content.
 */
export function selectRelevantDocs(
  conversationSummary: ConversationSummary,
  docs: Array<{ id?: string; title?: string; content?: string; sourceType?: string }>,
  maxDocs = 5
): Array<{ id: string; title: string; content: string; sourceType?: string }> {
  if (docs.length === 0) return []

  // Combine all searchable text from conversation
  const searchText = `${conversationSummary.threadSummary} ${conversationSummary.keyTopics.join(" ")} ${conversationSummary.openQuestions.join(" ")}`.toLowerCase()

  const scored = docs.map((doc) => {
    const docText = `${doc.title ?? ""} ${doc.content ?? ""}`.toLowerCase()
    let score = 0

    // Score by topic keyword overlap
    for (const topic of conversationSummary.keyTopics) {
      if (docText.includes(topic.toLowerCase())) {
        score += 10
      }
    }

    // Score by open question keyword overlap
    for (const q of conversationSummary.openQuestions) {
      const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
      for (const word of words) {
        if (docText.includes(word)) score += 3
      }
    }

    // Title match bonus
    const titleWords = (doc.title ?? "").toLowerCase().split(/\s+/).filter((w) => w.length > 3)
    for (const word of titleWords) {
      if (searchText.includes(word)) score += 5
    }

    return { doc, score }
  })

  const sortedScored = scored.sort((a, b) => b.score - a.score)

  // If no docs scored > 0, fall back to top docs by default (e.g. first added)
  const selected = sortedScored.filter((s) => s.score > 0)
  if (selected.length === 0) {
    // Return top maxDocs by original order (or first added)
    return docs.slice(0, maxDocs).map((doc, idx) => ({
      id: doc.id ?? `doc-${Date.now()}-${idx}`,
      title: doc.title ?? "Untitled",
      content: doc.content ?? "",
      sourceType: doc.sourceType,
    }))
  }

  return selected
    .slice(0, maxDocs)
    .map((s) => ({
      id: s.doc.id ?? `doc-${Date.now()}-${Math.random()}`,
      title: s.doc.title ?? "Untitled",
      content: s.doc.content ?? "",
      sourceType: s.doc.sourceType,
    }))
}