import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { groupCleanupBySender, type CleanupCandidate } from "@/lib/agent/sender-cleanup"
import AppRail from "@/app/components/AppRail"
import AppSidebar from "@/app/components/AppSidebar"
import AskFlowDeskPanel from "@/app/components/AskFlowDeskPanel"
import { getAppShellContext } from "@/lib/app-shell"
import CleanInboxClient from "@/app/clean-inbox/CleanInboxClient"
import CleanupTabNav from "@/app/clean-inbox/CleanupTabNav"

export const dynamic = "force-dynamic"

export default async function BulkUnsubscribePage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")
  const tenantId = session.user.tenantId

  const { needsReplyCount, pendingApprovals } = await getAppShellContext(tenantId)

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
    .filter((g) => g.hasUnsubscribe)
    .map((g) => ({
      senderEmail: g.senderEmail,
      senderName: g.senderName,
      domain: g.domain,
      count: g.count,
      sampleSubjects: g.sampleSubjects,
      conversationIds: g.conversationIds,
      hasUnsubscribe: g.hasUnsubscribe,
    }))

  return (
    <>
      <div className="lg:flex lg:h-screen">
        <div className="hidden lg:flex">
          <AppRail needsReplyCount={needsReplyCount} pendingApprovals={pendingApprovals} />
          <AppSidebar />
        </div>
        <div className="flex flex-1 flex-col overflow-hidden lg:overflow-y-auto">
          <div className="mx-auto max-w-2xl px-4 pt-8">
            <CleanupTabNav />
          </div>
          <CleanInboxClient groups={groups} />
        </div>
      </div>
      <AskFlowDeskPanel />
    </>
  )
}
