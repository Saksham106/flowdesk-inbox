import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

const DEFAULT_TEMPLATES = [
  {
    name: "Lead Quiet Follow-up",
    trigger: "lead_quiet_3d",
    stepsJson: [
      { type: "create_task", taskTitle: "Send follow-up to quiet lead", waitDaysAfterPrevious: 0 },
      { type: "wait", days: 3 },
      { type: "close_conversation" },
    ],
  },
  {
    name: "Scheduling Unconfirmed Nudge",
    trigger: "scheduling_unconfirmed_2d",
    stepsJson: [
      { type: "create_task", taskTitle: "Nudge scheduling confirmation", waitDaysAfterPrevious: 0 },
      { type: "wait", days: 2 },
      { type: "close_conversation" },
    ],
  },
  {
    name: "VIP No-Reply Follow-up",
    trigger: "vip_no_reply_2d",
    stepsJson: [
      { type: "create_task", taskTitle: "Follow up with VIP contact", waitDaysAfterPrevious: 0 },
      { type: "wait", days: 2 },
    ],
  },
]

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = session.user.tenantId

  let templates = await prisma.workflowTemplate.findMany({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
  })

  // Seed defaults if none exist
  if (templates.length === 0) {
    await prisma.workflowTemplate.createMany({
      data: DEFAULT_TEMPLATES.map((t) => ({ ...t, tenantId })),
    })
    templates = await prisma.workflowTemplate.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
    })
  }

  const runs = await prisma.workflowRun.findMany({
    where: { tenantId, status: "running" },
    select: { workflowTemplateId: true },
  })
  const activeCounts = runs.reduce<Record<string, number>>((acc, r) => {
    acc[r.workflowTemplateId] = (acc[r.workflowTemplateId] ?? 0) + 1
    return acc
  }, {})

  return NextResponse.json({ templates, activeCounts })
}
