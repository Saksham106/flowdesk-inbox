import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import AppRail from "@/app/components/AppRail"
import AskFlowDeskPanel from "@/app/components/AskFlowDeskPanel"
import { getAppShellContext } from "@/lib/app-shell"
import { getCleanupOverview } from "@/lib/cleanup-candidates"
import CleanInboxClient from "./CleanInboxClient"
import CleanupTabNav from "./CleanupTabNav"

export const dynamic = "force-dynamic"

export default async function CleanInboxPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")
  const tenantId = session.user.tenantId

  const { needsReplyCount, pendingApprovals } = await getAppShellContext(tenantId)
  const overview = await getCleanupOverview(tenantId)

  return (
    <>
      <div className="lg:flex lg:h-screen">
        <div className="hidden lg:flex">
          <AppRail needsReplyCount={needsReplyCount} pendingApprovals={pendingApprovals} />
        </div>
        <div className="flex flex-1 flex-col overflow-hidden lg:overflow-y-auto">
          <div className="mx-auto max-w-2xl px-4 pt-8">
            <CleanupTabNav />
          </div>
          <CleanInboxClient
            groups={overview.groups}
            mode="archive"
            protectedOrSkipped={overview.analytics.protectedOrSkipped}
            connectionIssue={overview.connectionIssue}
          />
        </div>
      </div>
      <AskFlowDeskPanel />
    </>
  )
}
