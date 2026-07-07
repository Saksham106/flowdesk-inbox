import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const enabled = body?.enabled
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "`enabled` must be a boolean" }, { status: 400 })
  }

  const tenantId = session.user.tenantId
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { salesCrmEnabled: enabled },
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      userId: session.user.id,
      action: "tenant.sales_crm_mode_changed",
      payloadJson: { enabled },
    },
  })

  return NextResponse.json({ ok: true, salesCrmEnabled: enabled })
}
