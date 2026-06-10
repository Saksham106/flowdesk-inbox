import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { buildOutlookAuthUrl, signOutlookState } from "@/lib/microsoft"

export const runtime = "nodejs"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_CLIENT_SECRET) {
    return NextResponse.json(
      { error: "Microsoft OAuth is not configured." },
      { status: 503 }
    )
  }

  const state = signOutlookState(session.user.tenantId)
  return NextResponse.redirect(buildOutlookAuthUrl(state))
}
