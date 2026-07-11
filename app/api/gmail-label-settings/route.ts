import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  FLOWDESK_GMAIL_LABEL_NAMES,
  isFlowDeskGmailLabelName,
} from "@/lib/email-labels"

export const runtime = "nodejs"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const mappings = await prisma.gmailLabelMapping.findMany({
    where: { tenantId: session.user.tenantId },
    select: { canonical: true, enabled: true },
  })
  const enabledByCanonical = new Map(mappings.map((m) => [m.canonical, m.enabled]))

  // Absence of a row means enabled (the default).
  const labels = FLOWDESK_GMAIL_LABEL_NAMES.map((canonical) => ({
    canonical,
    enabled: enabledByCanonical.get(canonical) ?? true,
  }))

  return NextResponse.json({ labels })
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    canonical?: string
    enabled?: boolean
  }

  if (!body.canonical || !isFlowDeskGmailLabelName(body.canonical)) {
    return NextResponse.json({ error: "Invalid label" }, { status: 400 })
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 })
  }

  const { canonical, enabled } = body

  await prisma.$transaction([
    prisma.gmailLabelMapping.upsert({
      where: {
        tenantId_canonical: { tenantId: session.user.tenantId, canonical },
      },
      create: { tenantId: session.user.tenantId, canonical, enabled },
      update: { enabled },
    }),
    prisma.auditLog.create({
      data: {
        tenantId: session.user.tenantId,
        action: "gmail.label_setting.update",
        payloadJson: { canonical, enabled },
      },
    }),
  ])

  return NextResponse.json({ ok: true })
}
