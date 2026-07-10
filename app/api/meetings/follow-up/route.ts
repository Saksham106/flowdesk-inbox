import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { salesCrmEnabled } from "@/lib/tenant-capabilities"
import { generateMeetingFollowUp } from "@/lib/ai/provider"
import { buildMeetingFollowUpPrompt } from "@/lib/ai/prompts/meeting-follow-up"
import { checkAiBudgetForTokens } from "@/lib/ai/budget"
import { estimateTokenCount, recordAiUsageEvent } from "@/lib/ai/usage"
import { ensureDraftApprovalRequest } from "@/lib/agent/approvals"
import type { MeetingFollowUpAttendee } from "@/lib/ai/prompts/meeting-follow-up"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const tenantId = session.user.tenantId

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { salesCrmEnabled: true },
  })
  if (!salesCrmEnabled(tenant)) {
    return NextResponse.json({ error: "Meeting follow-up requires Sales & CRM mode" }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { eventTitle, eventStart, attendeeEmails, calendarEmail, userNotes } = body as {
    eventTitle?: string
    eventStart?: string
    attendeeEmails?: string[]
    calendarEmail?: string
    userNotes?: string
  }

  if (!eventTitle || !eventStart || !Array.isArray(attendeeEmails) || !calendarEmail) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

  const credential = await prisma.googleCalendarCredential.findUnique({
    where: { tenantId_email: { tenantId, email: calendarEmail } },
  })
  if (!credential) {
    return NextResponse.json({ error: "Calendar not connected" }, { status: 403 })
  }

  const lowerEmails = attendeeEmails.map((e) => e.toLowerCase())

  const contacts = await prisma.contact.findMany({
    where: {
      tenantId,
      phoneE164: { in: lowerEmails },
    },
    include: {
      personMemory: true,
      conversations: {
        orderBy: { lastMessageAt: "desc" },
        take: 1,
      },
    },
  })

  const contactMap = new Map(contacts.map((c) => [c.phoneE164.toLowerCase(), c]))

  const attendees: MeetingFollowUpAttendee[] = attendeeEmails.map((email) => {
    const contact = contactMap.get(email.toLowerCase())
    if (!contact) return { email, name: null, personMemory: null }
    return {
      email,
      name: contact.name,
      personMemory: contact.personMemory?.summary
        ? { summary: contact.personMemory.summary, preferences: contact.personMemory.preferences }
        : null,
    }
  })

  const input = {
    aiContext: { tenantId, userId: session.user.id, userEmail: session.user.email ?? "" },
    eventTitle,
    eventStart: new Date(eventStart),
    userNotes: userNotes || "",
    attendees,
  }
  const prompt = buildMeetingFollowUpPrompt(input)
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini"
  const estimatedInputTokens = estimateTokenCount(prompt)
  const budgetCheck = await checkAiBudgetForTokens({
    tenantId,
    model,
    estimatedInputTokens,
    estimatedOutputTokens: 600,
  })
  if (!budgetCheck.allowed) {
    await recordAiUsageEvent({
      tenantId,
      feature: "meeting_follow_up",
      model,
      estimatedInputTokens,
      status: "blocked",
    })
    return NextResponse.json({ error: budgetCheck.reason }, { status: 429 })
  }

  let result: Awaited<ReturnType<typeof generateMeetingFollowUp>>
  try {
    result = await generateMeetingFollowUp(input)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate follow-up"
    const status = message.includes("spend limit reached") ? 429 : 502
    await recordAiUsageEvent({
      tenantId,
      feature: "meeting_follow_up",
      model,
      estimatedInputTokens,
      status: "failed",
    })
    return NextResponse.json({ error: message }, { status })
  }

  await recordAiUsageEvent({
    tenantId,
    feature: "meeting_follow_up",
    model: result.model,
    estimatedInputTokens,
    estimatedOutputTokens: estimateTokenCount(JSON.stringify(result)),
    status: "succeeded",
  })

  // Attach to the most recent conversation of the first matched contact.
  // Draft.conversationId is @unique — upsert replaces any existing draft on that conversation.
  const firstContactWithConversation = contacts.find((c) => c.conversations.length > 0)
  const conversationId = firstContactWithConversation?.conversations[0]?.id ?? null

  let approvalRequestId: string | null = null

  if (conversationId) {
    const draft = await prisma.draft.upsert({
      where: { conversationId },
      create: {
        conversationId,
        text: result.body,
        status: "proposed",
        metadataJson: { subject: result.subject, source: "meeting_follow_up", eventTitle },
      },
      update: {
        text: result.body,
        status: "proposed",
        metadataJson: { subject: result.subject, source: "meeting_follow_up", eventTitle },
      },
    })

    const approval = await ensureDraftApprovalRequest({
      tenantId,
      conversationId,
      draftId: draft.id,
      source: "meeting_follow_up",
    })
    approvalRequestId = approval.id
  }

  await prisma.auditLog.create({
    data: {
      tenantId,
      userId: session.user.id,
      action: "meeting_follow_up.draft_created",
      payloadJson: {
        eventTitle,
        approvalRequestId,
        attendeeCount: attendeeEmails.length,
        notesLength: (userNotes || "").length,
      },
    },
  })

  if (approvalRequestId) {
    return NextResponse.json({ approvalRequestId })
  }
  return NextResponse.json({ subject: result.subject, body: result.body })
}
