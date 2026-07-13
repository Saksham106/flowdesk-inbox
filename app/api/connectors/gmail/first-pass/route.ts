import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  DEFAULT_ONBOARDING_BATCH_SIZE,
  ONBOARDING_BATCH_SIZES,
  runOnboardingFirstPass,
  type OnboardingBatchSize,
} from "@/lib/agent/onboarding-first-pass"
import { revalidateInboxViews } from "@/lib/cache-tags"

export const runtime = "nodejs"

// The wizard lets the user pick how many recent threads to organize; anything
// outside the allowed set (including a missing/invalid body) falls back to the
// default rather than erroring — the pass is idempotent and bounded either way.
async function resolveBatchSize(request: Request): Promise<OnboardingBatchSize> {
  try {
    const body = (await request.json()) as { limit?: unknown }
    const limit = ONBOARDING_BATCH_SIZES.find((size) => size === body?.limit)
    return limit ?? DEFAULT_ONBOARDING_BATCH_SIZE
  } catch {
    return DEFAULT_ONBOARDING_BATCH_SIZE
  }
}

// Runs the onboarding first-pass for the session's tenant: labels a batch of
// existing inbox threads in Gmail and returns a proof summary the onboarding
// screen renders. Session-authed (a user organizing their own inbox), unlike
// the CRON_SECRET-gated reconcile cron. Safe to call more than once.
export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const batchSize = await resolveBatchSize(request)
  const result = await runOnboardingFirstPass(session.user.tenantId, { batchSize })

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
        batchSize,
      },
    },
  })

  if (result.organizedCount > 0) {
    revalidateInboxViews(session.user.tenantId)
  }

  return NextResponse.json(result)
}
