import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import OnboardingFirstPass from "./OnboardingFirstPass"

export const dynamic = "force-dynamic"

// Shown right after a fresh Gmail connect (see the OAuth callback redirect).
// The client component runs the first-pass and renders the proof of what was
// just organized before sending the user on to the control room.
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: { connected?: string }
}) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")

  return <OnboardingFirstPass connectedEmail={searchParams.connected ?? null} />
}
