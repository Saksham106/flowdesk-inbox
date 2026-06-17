import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import CleanInboxClient from "./CleanInboxClient"

export const dynamic = "force-dynamic"

export default async function CleanInboxPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")
  const tenantId = session.user.tenantId

  // Newsletters & marketing
  const newsletters = await prisma.conversation.findMany({
    where: {
      tenantId, status: { not: "closed" },
      stateRecord: { emailType: { in: ["newsletter", "marketing"] } },
    },
    select: {
      id: true,
      contact: { select: { name: true, phoneE164: true } },
      messages: { take: 1, orderBy: { createdAt: "asc" }, select: { subject: true } },
      stateRecord: { select: { metadataJson: true } },
    },
    take: 100,
    orderBy: { lastMessageAt: "desc" },
  })

  // Quiet emails
  const quietEmails = await prisma.conversation.findMany({
    where: {
      tenantId, status: { not: "closed" },
      stateRecord: { attentionCategory: "quiet" },
    },
    select: {
      id: true,
      contact: { select: { name: true, phoneE164: true } },
      messages: { take: 1, orderBy: { createdAt: "asc" }, select: { subject: true } },
    },
    take: 100,
  })

  // FYI done
  const fyiDone = await prisma.conversation.findMany({
    where: {
      tenantId, status: { not: "closed" },
      stateRecord: { attentionCategory: "fyi_done" },
    },
    select: {
      id: true,
      contact: { select: { name: true, phoneE164: true } },
      messages: { take: 1, orderBy: { createdAt: "asc" }, select: { subject: true } },
    },
    take: 100,
  })

  return (
    <CleanInboxClient
      newsletters={newsletters.map((c) => ({
        id: c.id,
        subject: c.messages[0]?.subject ?? "(no subject)",
        sender: c.contact?.name ?? c.contact?.phoneE164 ?? "Unknown",
        hasUnsubscribeUrl: !!(c.stateRecord?.metadataJson as Record<string, unknown> | null)?.unsubscribeUrl,
      }))}
      quietEmails={quietEmails.map((c) => ({
        id: c.id,
        subject: c.messages[0]?.subject ?? "(no subject)",
        sender: c.contact?.name ?? c.contact?.phoneE164 ?? "Unknown",
      }))}
      fyiDone={fyiDone.map((c) => ({
        id: c.id,
        subject: c.messages[0]?.subject ?? "(no subject)",
        sender: c.contact?.name ?? c.contact?.phoneE164 ?? "Unknown",
      }))}
    />
  )
}
