import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { streamInboxChat, type ChatMessage } from "@/lib/agent/inbox-chat"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const question: string = body?.question?.trim() ?? ""
  const history: ChatMessage[] = Array.isArray(body?.history) ? body.history : []

  if (!question) {
    return NextResponse.json({ error: "question required" }, { status: 400 })
  }

  const tenantId = session.user.tenantId

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const gen = streamInboxChat(tenantId, question, history)
        for await (const chunk of gen) {
          const data = `data: ${JSON.stringify({ text: chunk })}\n\n`
          controller.enqueue(new TextEncoder().encode(data))
        }
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Stream error"
        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify({ error: msg })}\n\n`)
        )
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
