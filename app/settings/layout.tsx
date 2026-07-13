import Link from "next/link"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import type { ReactNode } from "react"

import AppRail from "@/app/components/AppRail"
import AskFlowDeskPanel from "@/app/components/AskFlowDeskPanel"
import SettingsTabNav from "@/app/settings/SettingsTabNav"
import { authOptions } from "@/lib/auth"
import { getAppShellContext } from "@/lib/app-shell"

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions)
  const tenantId = session?.user?.tenantId
  if (!tenantId) redirect("/login")

  const { needsReplyCount, pendingApprovals } = await getAppShellContext(tenantId)

  return (
    <>
      <div className="hidden lg:flex lg:h-screen">
        <AppRail needsReplyCount={needsReplyCount} pendingApprovals={pendingApprovals} />
        <div className="flex flex-1 flex-col overflow-y-auto bg-slate-50">
          <SettingsContent>{children}</SettingsContent>
        </div>
      </div>
      <div className="min-h-screen bg-slate-50 lg:hidden">
        <SettingsContent>{children}</SettingsContent>
      </div>
      <AskFlowDeskPanel />
    </>
  )
}

function SettingsContent({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div>
            <Link href="/home" className="text-sm text-slate-500 hover:text-slate-700 lg:hidden">
              &larr; Back to home
            </Link>
            <h1 className="mt-1 font-serif text-2xl font-normal">Settings</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Tune what FlowDesk does in your Gmail, how much it can act on its own, and what it learns.
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <SettingsTabNav />
        <div className="min-w-0 space-y-10">{children}</div>
      </main>
    </>
  )
}
