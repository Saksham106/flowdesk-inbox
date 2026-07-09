import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { exchangeGoogleDriveCode, verifyDriveState } from "@/lib/integrations/google-drive"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")

  const redirectBase = `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/settings/connect`

  if (error) {
    return NextResponse.redirect(`${redirectBase}?drive_error=google_denied`)
  }

  if (!code || !state) {
    return NextResponse.redirect(`${redirectBase}?drive_error=invalid_callback`)
  }

  const tenantId = verifyDriveState(state)
  if (!tenantId) {
    return NextResponse.redirect(`${redirectBase}?drive_error=invalid_state`)
  }

  let email: string
  try {
    const result = await exchangeGoogleDriveCode(code, tenantId)
    email = result.email
  } catch {
    return NextResponse.redirect(`${redirectBase}?drive_error=token_exchange_failed`)
  }

  // Audit log: drive connected
  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "google_drive.connect",
      payloadJson: { email },
    },
  })

  return NextResponse.redirect(
    `${redirectBase}?drive_connected=${encodeURIComponent(email)}`
  )
}
