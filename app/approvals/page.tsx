import Link from "next/link"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

function metadataText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

export default async function ApprovalsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")

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

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/inbox" className="text-sm text-slate-500 hover:text-slate-700">
              ← Back to inbox
            </Link>
            <h1 className="mt-1 text-xl font-semibold">Approval Queue</h1>
            <p className="text-sm text-slate-500">
              {approvals.length} draft{approvals.length === 1 ? "" : "s"} waiting for review
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {approvals.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
            Nothing needs approval right now.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <ul className="divide-y divide-slate-100">
              {approvals.map((approval) => {
                const metadata = approval.draft?.metadataJson as Record<string, unknown> | null
                const displayName =
                  approval.conversation.contact?.name ?? approval.conversation.externalThreadId
                const lastMessage = approval.conversation.messages[0]
                return (
                  <li key={approval.id}>
                    <Link
                      href={`/conversations/${approval.conversationId}`}
                      className="block px-5 py-4 transition hover:bg-slate-50"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {displayName}
                          </p>
                          <p className="mt-1 truncate text-sm text-slate-500">
                            {lastMessage?.body ?? "No recent message"}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                            {metadataText(metadata?.intent) ? (
                              <span>Intent: {metadataText(metadata?.intent)}</span>
                            ) : null}
                            {metadataText(metadata?.riskLevel) ? (
                              <span>Risk: {metadataText(metadata?.riskLevel)}</span>
                            ) : null}
                            {metadataText(metadata?.confidence) ? (
                              <span>Confidence: {metadataText(metadata?.confidence)}</span>
                            ) : null}
                          </div>
                        </div>
                        <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
                          needs review
                        </span>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </main>
    </div>
  )
}
