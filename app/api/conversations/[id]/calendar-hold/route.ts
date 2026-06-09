import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { createCalendarHold } from "@/lib/agent/calendar-hold"

export const runtime = "nodejs"

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { calendarEmail, startAt, endAt } = body as {
    calendarEmail?: string
    startAt?: string
    endAt?: string
  }

  if (!calendarEmail || !startAt || !endAt) {
    return NextResponse.json({ error: "calendarEmail, startAt, and endAt are required" }, { status: 400 })
  }

  const start = new Date(startAt)
  const end = new Date(endAt)
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
    return NextResponse.json({ error: "Invalid startAt or endAt" }, { status: 400 })
  }

  try {
    const hold = await createCalendarHold(session.user.tenantId, {
      conversationId: params.id,
      calendarEmail,
      start,
      end,
    })
    return NextResponse.json({ hold })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create hold"
    const status = message.includes("does not belong") ? 404 : 502
    return NextResponse.json({ error: message }, { status })
  }
}
