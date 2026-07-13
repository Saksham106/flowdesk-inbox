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
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: { connected?: string }
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

  const step = resolveOnboardingStep({
    gmailConnected: Boolean(channel),
    styleTrained: Boolean(learnedProfile),
    justConnected: Boolean(searchParams.connected),
  })

  // Fully set up and not arriving from a fresh connect — nothing to onboard.
  if (step === "done") redirect("/home")

  return (
    <OnboardingWizard
      initialStep={step}
      connectedEmail={searchParams.connected ?? null}
      styleTrained={Boolean(learnedProfile)}
      microsoftConfigured={microsoftConfigured}
    />
  )
}
