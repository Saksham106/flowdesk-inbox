import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

export async function DELETE() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId

  // Capture email before deleting for the audit log
  const cred = await prisma.googleDriveCredential.findUnique({
    where: { tenantId },
    select: { email: true },
  })

  await prisma.googleDriveCredential.deleteMany({ where: { tenantId } })

  await prisma.auditLog.create({
    data: {
      tenantId,
      userId: session.user.id,
      action: "google_drive.disconnect",
      payloadJson: { email: cred?.email ?? null },
    },
  })

  return NextResponse.json({ ok: true })
}
