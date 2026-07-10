function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export type MeetingFollowUpResult = {
  subject: string
  body: string
  model: string
}

export type MeetingFollowUpAttendee = {
  email: string
  name: string | null
  personMemory: {
    summary: string
    preferences: string | null
  } | null
}

export type AiCallContext = { tenantId: string; userId: string; userEmail: string }

export type MeetingFollowUpPromptInput = {
  aiContext?: AiCallContext
  eventTitle: string
  eventStart: Date
  userNotes: string
  attendees: MeetingFollowUpAttendee[]
}

export const meetingFollowUpJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body"],
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
  },
}

export function buildMeetingFollowUpPrompt(input: MeetingFollowUpPromptInput): string {
  const recipientBlock = input.attendees
    .map((a) => {
      const name = a.name || a.email
      const parts = [`${name} <${a.email}>`]
      if (a.personMemory?.summary) parts.push(`[RELATIONSHIP_DATA: Relationship: ${a.personMemory.summary}]`)
      if (a.personMemory?.preferences) parts.push(`[RELATIONSHIP_DATA: Preferences: ${a.personMemory.preferences}]`)
      return parts.join(" — ")
    })
    .join("\n")

  return [
    "You are FlowDesk's post-meeting assistant. Write a professional follow-up email based on the meeting context and user's notes.",
    "",
    "Return only JSON matching the schema. Do not include markdown.",
    "",
    "Field guidance:",
    "- subject: a concise email subject line (e.g. 'Follow-up: [meeting title]').",
    "- body: full plain-text email body. Open with a brief thank-you, summarize what was discussed (from user notes), list action items if any, close warmly. Match tone to relationship context.",
    "",
    "Safety rules:",
    "- Only include action items explicitly stated in the user's notes.",
    "- Do not invent commitments or facts.",
    "- Keep it concise — 3-5 short paragraphs maximum.",
    "",
    `Meeting: ${input.eventTitle}`,
    `Date: ${input.eventStart.toISOString()}`,
    "",
    "Recipients:",
    recipientBlock,
    "",
    "User's meeting notes:",
    input.userNotes.trim() || "(No notes provided — write a brief generic thank-you and ask if there are next steps.)",
  ].join("\n")
}

export function normalizeMeetingFollowUpOutput(rawText: string, model: string): MeetingFollowUpResult {
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
  const subject = asTrimmedString(r.subject)
  const body = asTrimmedString(r.body)
  if (!subject || !body) throw new Error("AI response missing subject or body")
  return { subject, body, model }
}
