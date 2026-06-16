import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import type { AttentionCategory } from "@/lib/agent/email-classifier"

const VALID_CATEGORIES: AttentionCategory[] = [
  "needs_reply",
  "needs_action",
  "review_soon",
  "read_later",
  "waiting_on",
  "fyi_done",
  "quiet",
]

type DerivedAttentionState = {
  status: "needs_reply" | "in_progress" | "closed"
  userState: string
  state: string
  priority: string
  reason: string
  nextAction: string
}

function deriveAttentionState(attentionCategory: AttentionCategory): DerivedAttentionState {
  switch (attentionCategory) {
    case "needs_action":
      return {
        status: "needs_reply",
        userState: "needs_action",
        state: "waiting_on_you",
        priority: "high",
        reason: "User marked this conversation as needing action.",
        nextAction: "Complete the requested action.",
      }
    case "review_soon":
      return {
        status: "needs_reply",
        userState: "review_soon",
        state: "risky_urgent",
        priority: "high",
        reason: "User marked this conversation for review soon.",
        nextAction: "Review the alert and decide whether action is needed.",
      }
    case "read_later":
      return {
        status: "needs_reply",
        userState: "read_later",
        state: "fyi_only",
        priority: "low",
        reason: "User marked this conversation to read later.",
        nextAction: "Read later if relevant.",
      }
    case "waiting_on":
      return {
        status: "in_progress",
        userState: "waiting_on",
        state: "waiting_on_them",
        priority: "medium",
        reason: "User marked this conversation as waiting on someone else.",
        nextAction: "Check back later or send a follow-up.",
      }
    case "fyi_done":
      return {
        status: "closed",
        userState: "fyi_done",
        state: "fyi_only",
        priority: "none",
        reason: "User marked this conversation as FYI and done.",
        nextAction: "No action needed.",
      }
    case "quiet":
      return {
        status: "closed",
        userState: "quiet",
        state: "fyi_only",
        priority: "none",
        reason: "User marked this conversation as quiet.",
        nextAction: "No action needed.",
      }
    case "needs_reply":
    default:
      return {
        status: "needs_reply",
        userState: "needs_reply",
        state: "needs_reply",
        priority: "high",
        reason: "User marked this conversation as needing a reply.",
        nextAction: "Draft a reply.",
      }
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId
  const conversationId = params.id
  const body = await req.json()
  const { attentionCategory } = body

  if (!VALID_CATEGORIES.includes(attentionCategory)) {
    return NextResponse.json({ error: "Invalid attentionCategory" }, { status: 400 })
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    select: { id: true },
  })
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const existing = await prisma.conversationState.findUnique({
    where: { conversationId },
    select: { id: true, metadataJson: true },
  })

  const prevMeta =
    existing?.metadataJson && typeof existing.metadataJson === "object" && !Array.isArray(existing.metadataJson)
      ? (existing.metadataJson as Record<string, unknown>)
      : {}

  const now = new Date()
  const derived = deriveAttentionState(attentionCategory)
  const metadataJson = {
    ...prevMeta,
    attentionCategory,
    attentionCorrectedByUser: true,
    attentionCorrectedAt: now.toISOString(),
    userOverride: true,
    userState: derived.userState,
    updatedAt: now.toISOString(),
  }

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      status: derived.status,
      userState: derived.userState,
      userStateSource: "user",
      userStateUpdatedAt: now,
      ...(derived.status === "closed" ? { readAt: now, gmailUnread: false } : {}),
    },
  })

  await prisma.conversationState.upsert({
    where: { conversationId },
    create: {
      tenantId,
      conversationId,
      state: derived.state,
      priority: derived.priority,
      reason: derived.reason,
      nextAction: derived.nextAction,
      confidence: 1,
      source: "user_override",
      metadataJson,
    },
    update: {
      state: derived.state,
      priority: derived.priority,
      reason: derived.reason,
      nextAction: derived.nextAction,
      confidence: 1,
      source: "user_override",
      metadataJson,
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "conversation.attention_corrected",
      payloadJson: {
        conversationId,
        attentionCategory,
        previous: typeof prevMeta.attentionCategory === "string" ? prevMeta.attentionCategory : null,
        reason: "User manually corrected attention category",
      },
    },
  })

  return NextResponse.json({ ok: true })
}
