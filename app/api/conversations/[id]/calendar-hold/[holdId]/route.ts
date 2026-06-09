import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { cancelCalendarHold, confirmCalendarHold } from "@/lib/agent/calendar-hold"

export const runtime = "nodejs"

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; holdId: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    await cancelCalendarHold(params.holdId, session.user.tenantId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to cancel hold"
    const status = message.includes("not found") || message.includes("does not belong") ? 404 : 502
    return NextResponse.json({ error: message }, { status })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; holdId: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  if (body?.action !== "confirm") {
    return NextResponse.json({ error: 'action must be "confirm"' }, { status: 400 })
  }

  try {
    const hold = await confirmCalendarHold(params.holdId, session.user.tenantId)
    return NextResponse.json({ hold })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to confirm hold"
    const status = message.includes("not found") || message.includes("does not belong") ? 404 : 502
    return NextResponse.json({ error: message }, { status })
  }
}
