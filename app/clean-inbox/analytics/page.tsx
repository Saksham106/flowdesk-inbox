import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { groupCleanupBySender, type CleanupCandidate } from "@/lib/agent/sender-cleanup"
import CleanupTabNav from "@/app/clean-inbox/CleanupTabNav"

export const dynamic = "force-dynamic"

export default async function CleanupAnalyticsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")
  const tenantId = session.user.tenantId

  // Cleanable candidates: newsletters/marketing plus quietly-handled and FYI
  // mail. The grouping helper applies the safety skip rules (never needs-reply,
  // waiting-on, important, or receipts), so this query stays permissive.
  const conversations = await prisma.conversation.findMany({
    where: {
      tenantId,
      status: { not: "closed" },
      OR: [
        { stateRecord: { emailType: { in: ["newsletter", "marketing"] } } },
        { stateRecord: { attentionCategory: { in: ["quiet", "fyi_done"] } } },
      ],
    },
    select: {
      id: true,
      status: true,
      userState: true,
      lastMessageAt: true,
      contact: { select: { name: true, phoneE164: true } },
      messages: { take: 1, orderBy: { createdAt: "asc" }, select: { subject: true } },
      stateRecord: {
        select: { emailType: true, attentionCategory: true, metadataJson: true },
      },
    },
    take: 400,
    orderBy: { lastMessageAt: "desc" },
  })

  const candidates: CleanupCandidate[] = conversations.map((c) => {
    const meta =
      c.stateRecord?.metadataJson &&
      typeof c.stateRecord.metadataJson === "object" &&
      !Array.isArray(c.stateRecord.metadataJson)
        ? (c.stateRecord.metadataJson as Record<string, unknown>)
        : null
    return {
      id: c.id,
      senderEmail: c.contact?.phoneE164 ?? null,
      senderName: c.contact?.name ?? null,
      subject: c.messages[0]?.subject ?? null,
      emailType: c.stateRecord?.emailType ?? null,
      attentionCategory: c.stateRecord?.attentionCategory ?? null,
      status: c.status,
      userState: c.userState,
      hasUnsubscribe: typeof meta?.unsubscribeUrl === "string" && meta.unsubscribeUrl.length > 0,
      lastReceivedAt: c.lastMessageAt ?? new Date(0),
    }
  })

  const groups = groupCleanupBySender(candidates)

  const byDomain = new Map<string, number>()
  const byEmailType = new Map<string, number>()
  for (const candidate of candidates) {
    byEmailType.set(candidate.emailType ?? "unknown", (byEmailType.get(candidate.emailType ?? "unknown") ?? 0) + 1)
  }
  for (const group of groups) {
    byDomain.set(group.domain, (byDomain.get(group.domain) ?? 0) + group.count)
  }
  const topDomains = [...byDomain.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
  const totalCleanable = candidates.length
  const unsubscribableCount = groups.filter((g) => g.hasUnsubscribe).reduce((sum, g) => sum + g.count, 0)

  return (
    <>
      <div className="mx-auto max-w-2xl px-4 pt-8">
        <CleanupTabNav />
      </div>
      <main className="mx-auto max-w-5xl px-6 pb-8">
        <h1 className="text-xl font-semibold text-slate-900">Cleanup Analytics</h1>
        <p className="mb-6 text-sm text-slate-500">
          {totalCleanable} cleanable conversations across {groups.length} senders,{" "}
          {unsubscribableCount} with an unsubscribe link.
        </p>
        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-700">By content type</h2>
            <ul className="space-y-1 text-sm">
              {[...byEmailType.entries()].map(([type, count]) => (
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
              {topDomains.map(([domain, count]) => (
                <li key={domain} className="flex justify-between">
                  <span className="text-slate-600">{domain}</span>
                  <span className="text-slate-900">{count}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </>
  )
}
