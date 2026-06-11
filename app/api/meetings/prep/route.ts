import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { generateMeetingPrep } from "@/lib/ai/provider"
import { buildMeetingPrepPrompt } from "@/lib/ai/prompts/meeting-prep"
import { estimateTokenCount, recordAiUsageEvent } from "@/lib/ai/usage"
import type { MeetingPrepAttendee } from "@/lib/ai/prompts/meeting-prep"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const tenantId = session.user.tenantId

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { accountType: true },
  })
  if (tenant?.accountType === "personal") {
    return NextResponse.json({ error: "Meeting prep is only available for business accounts" }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { eventTitle, eventStart, attendeeEmails, calendarEmail } = body as {
    eventTitle?: string
    eventStart?: string
    attendeeEmails?: string[]
    calendarEmail?: string
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
        take: 5,
        include: { messages: { orderBy: { createdAt: "asc" }, take: 30 } },
      },
    },
  })

  const contactMap = new Map(contacts.map((c) => [c.phoneE164.toLowerCase(), c]))

  const attendees: MeetingPrepAttendee[] = attendeeEmails.map((email) => {
    const contact = contactMap.get(email.toLowerCase())
    if (!contact) return { email, name: null, personMemory: null, recentMessages: [] }
    const recentMessages = contact.conversations
      .flatMap((conv) => conv.messages)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(-20)
    return {
      email,
      name: contact.name,
      personMemory: contact.personMemory?.summary
        ? {
            summary: contact.personMemory.summary,
            preferences: contact.personMemory.preferences,
            openQuestions: contact.personMemory.openQuestions,
            promisedActions: contact.personMemory.promisedActions,
          }
        : null,
      recentMessages,
    }
  })

  const input = { eventTitle, eventStart: new Date(eventStart), attendees }

  let result: Awaited<ReturnType<typeof generateMeetingPrep>>
  try {
    result = await generateMeetingPrep(input)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate prep brief"
    const status = message.includes("OPENAI_API_KEY") ? 503 : 502
    await recordAiUsageEvent({
      tenantId,
      feature: "meeting_prep",
      model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
      status: "failed",
    })
    return NextResponse.json({ error: message }, { status })
  }

  await recordAiUsageEvent({
    tenantId,
    feature: "meeting_prep",
    model: result.model,
    estimatedInputTokens: estimateTokenCount(buildMeetingPrepPrompt(input)),
    estimatedOutputTokens: estimateTokenCount(JSON.stringify(result)),
    status: "succeeded",
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      userId: session.user.id,
      action: "meeting_prep.generated",
      payloadJson: {
        eventTitle,
        attendeeCount: attendeeEmails.length,
        matchedContactCount: contacts.length,
        model: result.model,
      },
    },
  })

  return NextResponse.json({ brief: result })
}
