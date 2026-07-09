import Link from "next/link"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import AppRail from "@/app/components/AppRail"
import AskFlowDeskPanel from "@/app/components/AskFlowDeskPanel"
import { getAppShellContext } from "@/lib/app-shell"
import ApprovalList, { type ApprovalItem } from "./ApprovalList"

export const dynamic = "force-dynamic"

function metadataText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

function ApprovalsContent({ count, items }: { count: number; items: ApprovalItem[] }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/home" className="text-sm text-slate-500 hover:text-slate-700 lg:hidden">
              ← Back to inbox
            </Link>
            <h1 className="mt-1 text-xl font-semibold">Approval Queue</h1>
            <p className="text-sm text-slate-500">
              {count} draft{count === 1 ? "" : "s"} waiting for review
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <ApprovalList items={items} />
      </main>
    </div>
  )
}

export default async function ApprovalsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")

  const { needsReplyCount, pendingApprovals } = await getAppShellContext(session.user.tenantId)

  const approvals = await prisma.approvalRequest.findMany({
    where: { tenantId: session.user.tenantId, status: "pending" },
    include: {
      draft: true,
      conversation: {
        include: {
          contact: true,
          channel: true,
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  })

  const items = approvals.map((approval) => {
    const metadata = approval.draft?.metadataJson as Record<string, unknown> | null
    const requestMeta = approval.metadataJson as Record<string, unknown> | null
    const bookingLabel =
      approval.step === "book_event"
        ? metadataText(requestMeta?.label) ?? metadataText(requestMeta?.start)
        : null
    return {
      id: approval.id,
      conversationId: approval.conversationId,
      displayName:
        approval.conversation.contact?.name ?? approval.conversation.externalThreadId,
      lastMessageBody: approval.conversation.messages[0]?.body ?? null,
      draftText: approval.draft?.text ?? null,
      actionLabel:
        approval.step === "book_event"
          ? `Book calendar event${bookingLabel ? ` — ${bookingLabel}` : ""}`
          : null,
      intent: metadataText(metadata?.intent),
      riskLevel: metadataText(metadata?.riskLevel),
      confidence: metadataText(metadata?.confidence),
    }
  })

  return (
    <>
      <div className="hidden lg:flex lg:h-screen">
        <AppRail needsReplyCount={needsReplyCount} pendingApprovals={pendingApprovals} />
        <div className="flex flex-1 flex-col overflow-y-auto">
          <ApprovalsContent count={approvals.length} items={items} />
        </div>
      </div>
      <div className="lg:hidden">
        <ApprovalsContent count={approvals.length} items={items} />
      </div>
      <AskFlowDeskPanel />
    </>
  )
}
