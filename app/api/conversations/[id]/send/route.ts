import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { ConversationSendError, sendConversationMessage } from "@/lib/conversations/send-message";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json();
  const text = typeof payload?.text === "string" ? payload.text.trim() : "";

  if (!text) {
    return NextResponse.json({ error: "Message text is required" }, { status: 400 });
  }

  try {
    await sendConversationMessage({
      conversationId: params.id,
      tenantId: session.user.tenantId,
      userId: session.user.id,
      text,
      auditAction: "conversation.send",
    });
  } catch (err) {
    if (err instanceof ConversationSendError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[send] unexpected error:", err);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
