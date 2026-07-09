import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import AppRail from "@/app/components/AppRail"
import AppSidebar from "@/app/components/AppSidebar"
import AskFlowDeskPanel from "@/app/components/AskFlowDeskPanel"
import { getAppShellContext } from "@/lib/app-shell"

export const dynamic = "force-dynamic"

const PLANNED_TOOLS = ["Calendar", "Meeting Briefs", "Attachments"]

export default async function ToolsPage() {
  const session = await getServerSession(authOptions)
  const tenantId = session?.user?.tenantId
  if (!tenantId) redirect("/login")

  const { needsReplyCount, pendingApprovals } = await getAppShellContext(tenantId)

  return (
    <>
      <div className="lg:flex lg:h-screen">
        <div className="hidden lg:flex">
          <AppRail needsReplyCount={needsReplyCount} pendingApprovals={pendingApprovals} />
          <AppSidebar />
        </div>
        <main className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <h1 className="text-xl font-semibold text-slate-900">Tools</h1>
          <p className="max-w-sm text-sm text-slate-500">
            {PLANNED_TOOLS.join(", ")} are planned but not built yet. Nothing here works today.
          </p>
        </main>
      </div>
      <AskFlowDeskPanel />
    </>
  )
}
