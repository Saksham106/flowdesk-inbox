import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import AppRail from "@/app/components/AppRail"
import AskFlowDeskPanel from "@/app/components/AskFlowDeskPanel"
import { getAppShellContext } from "@/lib/app-shell"
import { getCleanupOverview } from "@/lib/cleanup-candidates"
import CleanupTabNav from "@/app/clean-inbox/CleanupTabNav"

export const dynamic = "force-dynamic"

export default async function CleanupAnalyticsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")
  const tenantId = session.user.tenantId

  const { needsReplyCount, pendingApprovals } = await getAppShellContext(tenantId)
  const { groups, analytics } = await getCleanupOverview(tenantId)

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
          <main className="mx-auto max-w-5xl px-6 pb-8">
            <h1 className="text-xl font-semibold text-slate-900">Cleanup Analytics</h1>
            <p className="mb-6 text-sm text-slate-500">
              {analytics.totalCleanable} cleanable conversations across {groups.length} senders,{" "}
              {analytics.unsubscribableCount} with an unsubscribe link.
              {analytics.protectedOrSkipped > 0 && (
                <>
                  {" "}
                  {analytics.protectedOrSkipped} more protected by safety rules (needs reply,
                  waiting on, receipts, etc.) and excluded.
                </>
              )}
            </p>
            <div className="grid gap-6 md:grid-cols-2">
              <section className="rounded-xl border border-slate-200 bg-white p-4">
                <h2 className="mb-2 text-sm font-semibold text-slate-700">By content type</h2>
                <ul className="space-y-1 text-sm">
                  {analytics.byEmailType.map(([type, count]) => (
                    <li key={type} className="flex justify-between">
                      <span className="text-slate-600">{type}</span>
                      <span className="text-slate-900">{count}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="rounded-xl border border-slate-200 bg-white p-4">
                <h2 className="mb-2 text-sm font-semibold text-slate-700">Top domains</h2>
                <ul className="space-y-1 text-sm">
                  {analytics.topDomains.map(([domain, count]) => (
                    <li key={domain} className="flex justify-between">
                      <span className="text-slate-600">{domain}</span>
                      <span className="text-slate-900">{count}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </main>
        </div>
      </div>
      <AskFlowDeskPanel />
    </>
  )
}
