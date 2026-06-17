import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { buildBatchToken } from "@/app/api/clean-inbox/archive-batch/route"

function isSafeUnsubscribeUrl(raw: string): boolean {
  let url: URL
  try { url = new URL(raw) } catch { return false }
  if (url.protocol !== "https:") return false
  const host = url.hostname.toLowerCase()
  // Block loopback, link-local, RFC-1918 ranges
  if (
    host === "localhost" ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host.match(/^172\.(1[6-9]|2\d|3[01])\./) ||
    host === "[::1]" ||
    host.startsWith("169.254.")
  ) return false
  return true
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { conversationIds } = await request.json()
  if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
    return NextResponse.json({ error: "conversationIds required" }, { status: 400 })
  }
  const tenantId = session.user.tenantId

  const convs = await prisma.conversation.findMany({
    where: { id: { in: conversationIds }, tenantId },
    include: { stateRecord: { select: { metadataJson: true } } },
  })

  let unsubscribed = 0
  for (const conv of convs) {
    const meta = conv.stateRecord?.metadataJson as Record<string, unknown> | null
    const url = typeof meta?.unsubscribeUrl === "string" ? meta.unsubscribeUrl : null
    if (url && isSafeUnsubscribeUrl(url)) {
      fetch(url, { method: "GET", redirect: "manual" }).catch(() => {})
      unsubscribed++
    }
  }

  const ids = convs.map((c) => c.id)

  await prisma.conversation.updateMany({
    where: { id: { in: ids }, tenantId },
    data: { status: "closed" },
  })

  const batchToken = buildBatchToken(ids)
  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "clean_inbox.unsubscribe_batch",
      payloadJson: { batchToken, conversationIds: ids, unsubscribed } as Prisma.InputJsonValue,
    },
  })

  return NextResponse.json({ ok: true, processed: convs.length, unsubscribed, batchToken })
}
