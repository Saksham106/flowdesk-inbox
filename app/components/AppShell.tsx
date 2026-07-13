import type { ReactNode } from "react"

import AppRail from "@/app/components/AppRail"
import AskFlowDeskPanel from "@/app/components/AskFlowDeskPanel"
import { getAppShellContext } from "@/lib/app-shell"

/**
 * Shared logged-in chrome for standalone pages (Tasks, Activity, and the
 * Sales & CRM surfaces) that previously rendered as dead ends with no
 * navigation. Desktop gets the app rail; on mobile the page's own header and
 * back-links remain the navigation, matching Home/Mail.
 */
export default async function AppShell({ tenantId, children }: { tenantId: string; children: ReactNode }) {
  const { needsReplyCount, pendingApprovals } = await getAppShellContext(tenantId)

  return (
    <>
      <div className="flex min-h-screen">
        <div className="sticky top-0 hidden h-screen shrink-0 lg:block">
          <AppRail needsReplyCount={needsReplyCount} pendingApprovals={pendingApprovals} />
        </div>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      <AskFlowDeskPanel />
    </>
  )
}
