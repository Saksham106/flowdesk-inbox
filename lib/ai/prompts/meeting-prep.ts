function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export type MeetingPrepResult = {
  contactSummary: string
  whatTheyAskedAbout: string[]
  lastTone: string
  talkingPoints: string[]
  openItems: string[]
  riskFlags: string[]
  model: string
}

export type MeetingPrepAttendee = {
  email: string
  name: string | null
  personMemory: {
    summary: string
    preferences: string | null
    openQuestions: string | null
    promisedActions: string | null
  } | null
  recentMessages: Array<{ direction: string; body: string; createdAt: Date }>
}

export type AiCallContext = { tenantId: string; userId: string; userEmail: string }

export type MeetingPrepPromptInput = {
  aiContext?: AiCallContext
  eventTitle: string
  eventStart: Date
  attendees: MeetingPrepAttendee[]
}

export const meetingPrepJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "contactSummary",
    "whatTheyAskedAbout",
    "lastTone",
    "talkingPoints",
    "openItems",
    "riskFlags",
  ],
  properties: {
    contactSummary: { type: "string" },
    whatTheyAskedAbout: { type: "array", items: { type: "string" } },
    lastTone: { type: "string" },
    talkingPoints: { type: "array", items: { type: "string" } },
    openItems: { type: "array", items: { type: "string" } },
    riskFlags: { type: "array", items: { type: "string" } },
  },
}

export function buildMeetingPrepPrompt(input: MeetingPrepPromptInput): string {
  const attendeeBlock = input.attendees
    .map((a) => {
      const name = a.name || a.email
      const lines: string[] = [`Attendee: ${name} <${a.email}>`]
      if (a.personMemory) {
        lines.push(`[RELATIONSHIP_DATA: Relationship: ${a.personMemory.summary}]`)
        if (a.personMemory.preferences) lines.push(`[RELATIONSHIP_DATA: Preferences: ${a.personMemory.preferences}]`)
        if (a.personMemory.openQuestions) lines.push(`[RELATIONSHIP_DATA: Open questions they raised: ${a.personMemory.openQuestions}]`)
        if (a.personMemory.promisedActions) lines.push(`[RELATIONSHIP_DATA: Things you promised: ${a.personMemory.promisedActions}]`)
      } else {
        lines.push("No prior email history with this attendee.")
      }
      if (a.recentMessages.length > 0) {
        lines.push("Recent messages (oldest first):")
        a.recentMessages.slice(-20).forEach((m) => {
          const ts = m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt)
          lines.push(`  ${ts} ${m.direction.toUpperCase()}: ${truncate(m.body, 400)}`)
        })
      }
      return lines.join("\n")
    })
    .join("\n\n---\n\n")

  return [
    "You are FlowDesk's meeting prep assistant. Prepare a concise briefing for a busy user about to join a meeting.",
    "OUTBOUND messages were sent by the user. INBOUND messages were sent by the attendee.",
    "",
    "Return only JSON matching the schema. Do not include markdown.",
    "",
    "Field guidance:",
    "- contactSummary: 1-2 sentences on who this person is and the relationship status.",
    "- whatTheyAskedAbout: key topics, questions, or requests from prior emails. Empty array if no prior history.",
    "- lastTone: describe the most recent emotional/professional tone in 3-5 words (e.g. 'warm and enthusiastic', 'frustrated about delays', 'new contact, no prior emails').",
    "- talkingPoints: 2-4 specific things the user should bring up or push for in this meeting, based on email history.",
    "- openItems: promises the user made or questions the attendee raised that have not been resolved. Empty if none.",
    "- riskFlags: sensitive topics to handle carefully. Empty array if none.",
    "",
    "Safety rules:",
    "- Do not invent facts not present in the email history.",
    "- If there is no prior history, return empty arrays for whatTheyAskedAbout, talkingPoints, openItems, riskFlags.",
    "",
    `Meeting: ${input.eventTitle}`,
    `Scheduled: ${input.eventStart.toISOString()}`,
    "",
    "Attendee context:",
    attendeeBlock,
  ].join("\n")
}

export function normalizeMeetingPrepOutput(rawText: string, model: string): MeetingPrepResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new Error("AI response was not valid JSON")
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("AI response was not an object")
  }
  const r = parsed as Record<string, unknown>
  const contactSummary = asTrimmedString(r.contactSummary)
  if (!contactSummary) throw new Error("AI response did not include contactSummary")
  return {
    contactSummary,
    whatTheyAskedAbout: asStringArray(r.whatTheyAskedAbout),
    lastTone: asTrimmedString(r.lastTone) || "unknown",
    talkingPoints: asStringArray(r.talkingPoints),
    openItems: asStringArray(r.openItems),
    riskFlags: asStringArray(r.riskFlags),
    model,
  }
}
