import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { runOnboardingFirstPass } from "@/lib/agent/onboarding-first-pass"
import { revalidateInboxViews } from "@/lib/cache-tags"

export const runtime = "nodejs"

// Runs the onboarding first-pass for the session's tenant: labels a batch of
// existing inbox threads in Gmail and returns a proof summary the onboarding
// screen renders. Session-authed (a user organizing their own inbox), unlike
// the CRON_SECRET-gated reconcile cron. Safe to call more than once.
export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await runOnboardingFirstPass(session.user.tenantId)

  await prisma.auditLog.create({
    data: {
      tenantId: session.user.tenantId,
      action: "onboarding.first_pass",
      payloadJson: {
        organizedCount: result.organizedCount,
        byLabel: result.byLabel,
        hadEmailChannel: result.hadEmailChannel,
        belowAutomationLevel: result.belowAutomationLevel,
        errors: result.errors,
      },
    },
  })

  if (result.organizedCount > 0) {
    revalidateInboxViews(session.user.tenantId)
  }

  return NextResponse.json(result)
}
