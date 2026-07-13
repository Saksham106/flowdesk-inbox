import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { resolveOnboardingStep } from "@/lib/onboarding"
import { prisma } from "@/lib/prisma"
import OnboardingWizard from "./OnboardingWizard"

export const dynamic = "force-dynamic"

// New signups land here (login page redirect), and a fresh Gmail connect
// returns here via the OAuth callback (?connected=<email>). Steps derive from
// real state, so returning users resume at the first incomplete step.
// Settings offers ?restart=1 to walk the wizard again on a fully-set-up
// account: it re-enters at the organize step (or connect, if no inbox is
// connected) and offers style retraining instead of redirecting to /home.
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: { connected?: string; restart?: string }
}) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")

  const [channel, learnedProfile] = await Promise.all([
    prisma.channel.findFirst({
      where: { tenantId: session.user.tenantId, type: "email" },
      select: { id: true },
    }),
    prisma.learnedReplyProfile.findFirst({
      where: { tenantId: session.user.tenantId },
      select: { id: true },
    }),
  ])

  // Mirrors the Settings → Connect gating: Outlook is offered to every
  // account whenever the app-level MICROSOFT_CLIENT_ID/SECRET are configured
  // (full parity shipped in PR #143).
  const microsoftConfigured = Boolean(
    process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET
  )

  const restart = Boolean(searchParams.restart)

  const step = resolveOnboardingStep({
    gmailConnected: Boolean(channel),
    styleTrained: Boolean(learnedProfile),
    // A restart with a connected inbox re-enters at the organize step, same
    // as arriving from a fresh connect; without one it falls back to connect.
    justConnected: Boolean(searchParams.connected) || (restart && Boolean(channel)),
  })

  // Fully set up and not arriving from a fresh connect — nothing to onboard.
  if (step === "done" && !restart) redirect("/home")

  return (
    <OnboardingWizard
      initialStep={step}
      connectedEmail={searchParams.connected ?? null}
      // On restart, offer the train step again even if a profile exists —
      // retraining is idempotent and the user asked to redo setup.
      styleTrained={Boolean(learnedProfile) && !restart}
      microsoftConfigured={microsoftConfigured}
    />
  )
}
