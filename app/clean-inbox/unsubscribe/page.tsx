import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import AppRail from "@/app/components/AppRail"
import AskFlowDeskPanel from "@/app/components/AskFlowDeskPanel"
import { getAppShellContext } from "@/lib/app-shell"
import { getCleanupOverview } from "@/lib/cleanup-candidates"
import CleanInboxClient from "@/app/clean-inbox/CleanInboxClient"
import CleanupTabNav from "@/app/clean-inbox/CleanupTabNav"
import { parseCleanupRange } from "@/lib/cleanup-range"

export const dynamic = "force-dynamic"

export default async function BulkUnsubscribePage({ searchParams }: { searchParams: { range?: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")
  const tenantId = session.user.tenantId

  const { needsReplyCount, pendingApprovals } = await getAppShellContext(tenantId)
  const range = parseCleanupRange(searchParams.range)
  const overview = await getCleanupOverview(tenantId, range)

  return (
    <>
      <div className="lg:flex lg:h-screen">
        <div className="hidden lg:flex">
          <AppRail needsReplyCount={needsReplyCount} pendingApprovals={pendingApprovals} />
        </div>
        <div className="flex flex-1 flex-col overflow-hidden lg:overflow-y-auto">
          <div className="mx-auto max-w-2xl px-4 pt-8">
            <CleanupTabNav range={range} />
          </div>
          <CleanInboxClient
            groups={overview.unsubscribeGroups}
            labelGroups={[]}
            mode="unsubscribe"
            range={range}
            protectedOrSkipped={overview.analytics.protectedOrSkipped}
            noUnsubscribeLinkCount={overview.analytics.noUnsubscribeLinkCount}
            connectionIssue={overview.connectionIssue}
          />
        </div>
      </div>
      <AskFlowDeskPanel />
    </>
  )
}
