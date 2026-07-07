import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { DEFAULT_CONCIERGE_TEMPLATES, buildTemplateDocument } from "@/lib/agent/concierge-templates"
import { salesCrmEnabled } from "@/lib/tenant-capabilities"

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId

  // Concierge templates are part of the Sales & CRM capability.
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { salesCrmEnabled: true },
  })
  if (!salesCrmEnabled(tenant)) {
    return NextResponse.json({ error: "Concierge templates require Sales & CRM mode" }, { status: 403 })
  }

  // Only seed if no templates already exist
  const existing = await prisma.knowledgeDocument.count({
    where: { tenantId, sourceType: "concierge_template" },
  })
  if (existing > 0) {
    return NextResponse.json({ seeded: 0, message: "Templates already seeded" })
  }

  await prisma.knowledgeDocument.createMany({
    data: DEFAULT_CONCIERGE_TEMPLATES.map((t) => buildTemplateDocument(t, tenantId)),
  })

  return NextResponse.json({ seeded: DEFAULT_CONCIERGE_TEMPLATES.length })
}
