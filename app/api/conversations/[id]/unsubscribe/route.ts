import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

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

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
    select: { id: true, tenantId: true },
  })
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const state = await prisma.conversationState.findUnique({
    where: { conversationId: params.id },
    select: { metadataJson: true },
  })
  const meta =
    state?.metadataJson && typeof state.metadataJson === "object" && !Array.isArray(state.metadataJson)
      ? (state.metadataJson as Record<string, unknown>)
      : {}
  const unsubscribeUrl = typeof meta.unsubscribeUrl === "string" ? meta.unsubscribeUrl : null

  if (unsubscribeUrl && isSafeUnsubscribeUrl(unsubscribeUrl)) {
    // Fire-and-forget GET request to unsubscribe URL
    fetch(unsubscribeUrl, { method: "GET", redirect: "manual" }).catch(() => {/* ignore errors */})
  }

  // Close the conversation and log
  await prisma.conversation.update({
    where: { id: params.id },
    data: { status: "closed" },
  })
  await prisma.auditLog.create({
    data: {
      tenantId: conversation.tenantId,
      action: "conversation.unsubscribed",
      payloadJson: { conversationId: params.id, unsubscribeUrl },
    },
  })

  return NextResponse.json({ ok: true })
}
