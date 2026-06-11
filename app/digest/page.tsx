import Link from "next/link"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { buildDailyCommandCenter } from "@/lib/agent/command-center"
import { prisma } from "@/lib/prisma"
import DailyBriefSections from "@/app/digest/DailyBriefSections"

export const dynamic = "force-dynamic"

function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return "today"
  if (diffDays === 1) return "yesterday"
  return `${diffDays}d ago`
}

export default async function DigestPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")

  const tenantId = session.user.tenantId
  const now = new Date()
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)

  const [
    pendingFollowUps,
    needsReply,
    pendingApprovals,
    expiringHolds,
    commandCenterConversations,
  ] = await Promise.all([
    // Conversations with a queued follow_up job
    prisma.agentJob.findMany({
      where: { tenantId, trigger: "follow_up", status: "pending" },
      include: {
        conversation: {
          include: { contact: true, channel: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    // Conversations still needing a reply (no follow_up job yet)
    prisma.conversation.findMany({
      where: {
        tenantId,
        status: "needs_reply",
        lastMessageAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
      include: { contact: true, channel: true },
      orderBy: { lastMessageAt: "asc" },
      take: 20,
    }),
    // Pending approval requests
    prisma.approvalRequest.findMany({
      where: { tenantId, status: "pending" },
      include: {
        conversation: { include: { contact: true, channel: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    // Calendar holds expiring within 24 hours
    prisma.calendarHold.findMany({
      where: {
        tenantId,
        status: "held",
        expiresAt: { lte: in24h },
      },
      include: {
        conversation: { include: { contact: true } },
      },
      orderBy: { expiresAt: "asc" },
      take: 10,
    }),
    prisma.conversation.findMany({
      where: { tenantId },
      include: {
        messages: { orderBy: { createdAt: "asc" }, take: 20 },
        channel: true,
        contact: true,
        draft: true,
        agentJobs: { orderBy: { createdAt: "desc" }, take: 3 },
        approvalRequests: {
          where: { status: "pending" },
          orderBy: { createdAt: "desc" },
          take: 3,
        },
        calendarHolds: {
          where: { status: "held" },
          orderBy: { expiresAt: "asc" },
          take: 3,
        },
      },
      orderBy: { lastMessageAt: "desc" },
      take: 100,
    }),
  ])

  const totalItems =
    pendingFollowUps.length +
    needsReply.length +
    pendingApprovals.length +
    expiringHolds.length

  const commandCenter = buildDailyCommandCenter(commandCenterConversations, now)

  function convName(
    contact: { name: string } | null,
    thread: string
  ): string {
    return contact?.name ?? thread
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/inbox" className="text-sm text-slate-500 hover:text-slate-700">
              ← Back to inbox
            </Link>
            <h1 className="mt-1 text-xl font-semibold">Daily Digest</h1>
            <p className="text-sm text-slate-500">
              {now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </p>
          </div>
          <span className="rounded-full bg-slate-900 px-3 py-1 text-sm font-medium text-white">
            {totalItems} item{totalItems !== 1 ? "s" : ""}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        <DailyBriefSections commandCenter={commandCenter} />

        {totalItems === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <p className="text-slate-500">All caught up — nothing needs attention right now.</p>
          </div>
        )}

        {/* Follow-up jobs queued */}
        {pendingFollowUps.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-6 py-4">
              <h2 className="font-semibold">Follow-ups to send</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                These conversations went quiet. Open each to suggest a follow-up reply.
              </p>
            </div>
            <ul className="divide-y divide-slate-100">
              {pendingFollowUps.map((job) => (
                <li key={job.id}>
                  <Link
                    href={`/conversations/${job.conversationId}`}
                    className="flex items-center justify-between px-6 py-4 hover:bg-slate-50"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {convName(job.conversation.contact, job.conversation.externalThreadId)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {job.conversation.channel.emailAddress ?? job.conversation.externalThreadId}
                      </p>
                    </div>
                    <span className="text-xs text-slate-400">
                      last reply {relativeTime(job.conversation.lastMessageAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Needs reply — dropped ball */}
        {needsReply.length > 0 && (
          <section className="rounded-xl border border-amber-200 bg-white shadow-sm">
            <div className="border-b border-amber-100 px-6 py-4">
              <h2 className="font-semibold text-amber-800">Awaiting your reply</h2>
              <p className="mt-0.5 text-sm text-amber-700">
                These conversations have an unanswered inbound message older than 24 hours.
              </p>
            </div>
            <ul className="divide-y divide-amber-50">
              {needsReply.map((conv) => (
                <li key={conv.id}>
                  <Link
                    href={`/conversations/${conv.id}`}
                    className="flex items-center justify-between px-6 py-4 hover:bg-amber-50"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {convName(conv.contact, conv.externalThreadId)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {conv.channel.emailAddress ?? conv.externalThreadId}
                      </p>
                    </div>
                    <span className="text-xs text-amber-600 font-medium">
                      {relativeTime(conv.lastMessageAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Pending approvals */}
        {pendingApprovals.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-6 py-4">
              <h2 className="font-semibold">Pending approvals</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                AI-drafted replies waiting for your review.
              </p>
            </div>
            <ul className="divide-y divide-slate-100">
              {pendingApprovals.map((req) => (
                <li key={req.id}>
                  <Link
                    href={`/conversations/${req.conversationId}`}
                    className="flex items-center justify-between px-6 py-4 hover:bg-slate-50"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {convName(req.conversation.contact, req.conversation.externalThreadId)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {req.conversation.channel.emailAddress ?? req.conversation.externalThreadId}
                      </p>
                    </div>
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                      needs review
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Expiring holds */}
        {expiringHolds.length > 0 && (
          <section className="rounded-xl border border-red-200 bg-white shadow-sm">
            <div className="border-b border-red-100 px-6 py-4">
              <h2 className="font-semibold text-red-800">Calendar holds expiring soon</h2>
              <p className="mt-0.5 text-sm text-red-700">
                Confirm or cancel these holds before they expire.
              </p>
            </div>
            <ul className="divide-y divide-red-50">
              {expiringHolds.map((hold) => (
                <li key={hold.id}>
                  <Link
                    href={`/conversations/${hold.conversationId}`}
                    className="flex items-center justify-between px-6 py-4 hover:bg-red-50"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {convName(hold.conversation.contact, hold.conversation.externalThreadId)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {hold.startAt.toLocaleString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                          hour12: true,
                        })}
                      </p>
                    </div>
                    <span className="text-xs text-red-600 font-medium">
                      expires {hold.expiresAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}
