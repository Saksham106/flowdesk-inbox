import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { proposeDraftForConversation } from "@/lib/agent/draft-generation"

export const runtime = "nodejs"

const MAX_USER_INSTRUCTION_LENGTH = 500

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userInstruction = await parseUserInstruction(request)
  if (userInstruction instanceof NextResponse) return userInstruction

  const result = await proposeDraftForConversation({
    tenantId: session.user.tenantId,
    conversationId: params.id,
    userId: session.user.id,
    userEmail: session.user.email ?? "",
    userInstruction,
    source: "manual",
  })

  if (result.status === "not_applicable") {
    return NextResponse.json(
      { error: result.reason },
      { status: result.reason === "Conversation not found" ? 404 : 400 }
    )
  }
  if (result.status === "error") {
    const status = result.message.includes("spend limit reached") ? 429 : 502
    return NextResponse.json({ error: result.message }, { status })
  }
  if (result.status === "writing_preference_violation") {
    return NextResponse.json(
      { error: result.message, validationFailures: result.validationFailures },
      { status: 422 }
    )
  }
  if (result.status === "gated_out") {
    return NextResponse.json({ error: result.reason }, { status: 422 })
  }

  return NextResponse.json({ draft: result.draft, meta: result.draft.metadataJson ?? {} })
}

async function parseUserInstruction(request: Request): Promise<string | null | NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return null
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const value = (body as Record<string, unknown>).userInstruction
  if (value === undefined || value === null) return null
  if (typeof value !== "string") {
    return NextResponse.json({ error: "User instruction must be text" }, { status: 400 })
  }
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > MAX_USER_INSTRUCTION_LENGTH) {
    return NextResponse.json({ error: "User instruction must be 500 characters or fewer" }, { status: 400 })
  }
  return trimmed
}
