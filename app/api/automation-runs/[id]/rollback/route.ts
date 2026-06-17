import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { rollbackAutomationStep, type AutomationStep } from "@/lib/agent/automation-runner"
import { Prisma } from "@prisma/client"

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const run = await prisma.automationRun.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
  })
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (run.status === "rolled_back") return NextResponse.json({ error: "Already rolled back" }, { status: 409 })

  // Rollback window: 24h
  const age = Date.now() - run.createdAt.getTime()
  if (age > 24 * 60 * 60 * 1000) return NextResponse.json({ error: "Rollback window expired" }, { status: 410 })

  const steps = (run.stepsJson as AutomationStep[]).filter((s) => s.status === "completed").reverse()
  for (const step of steps) {
    if (step.rollbackData) {
      await rollbackAutomationStep(step as AutomationStep & { rollbackData: Record<string, unknown> })
    }
  }

  await prisma.automationRun.update({
    where: { id: params.id },
    data: { status: "rolled_back", rolledBackAt: new Date() },
  })

  await prisma.auditLog.create({
    data: {
      tenantId: session.user.tenantId,
      action: "automation_run.rolled_back",
      payloadJson: { automationRunId: params.id, stepsRolledBack: steps.length } as Prisma.InputJsonValue,
    },
  })

  return NextResponse.json({ ok: true, stepsRolledBack: steps.length })
}
