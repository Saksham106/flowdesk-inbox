import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { isFlowDeskGmailLabelName } from "@/lib/email-labels"
import { setConversationFlowDeskLabel } from "@/lib/conversation-labels"

// The unified manual-label-correction endpoint: the single place a user
// changes what FlowDesk considers a conversation's label. Supersedes the
// overlapping workflow-status select / attention-correction endpoint for
// this purpose — see lib/conversation-labels.ts for the full label -> state
// mapping and the five side effects every correction performs.
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId || !session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const label = typeof body?.label === "string" ? body.label : ""

  if (!isFlowDeskGmailLabelName(label)) {
    return NextResponse.json({ error: "Invalid label" }, { status: 400 })
  }

  const result = await setConversationFlowDeskLabel({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    conversationId: params.id,
    label,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ ok: true })
}
