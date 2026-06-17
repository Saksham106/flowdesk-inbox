import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getGoogleDriveAuthUrl, signDriveState } from "@/lib/integrations/google-drive"

export const runtime = "nodejs"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.json({ error: "Google OAuth is not configured." }, { status: 503 })
  }

  const state = signDriveState(session.user.tenantId)
  const url = getGoogleDriveAuthUrl(state)
  return NextResponse.redirect(url)
}
