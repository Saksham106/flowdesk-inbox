import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

export async function GET() {
  const session = await getServerSession(authOptions)
  const tenantId = session?.user?.tenantId

  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const [statusCounts, gmailChannels] = await Promise.all([
    prisma.conversation.groupBy({
      by: ["status"],
      where: { tenantId },
      _count: { status: true },
    }),
    prisma.channel.findMany({
      where: { tenantId, type: "email", provider: "google" },
      select: {
        id: true,
        gmailCredential: {
          select: {
            lastSyncedAt: true,
            lastSyncError: true,
            watchExpiresAt: true,
            watchRenewalError: true,
            watchLastRenewalAttempt: true,
            lastHistoryFallbackAt: true,
          },
        },
      },
    }),
  ])

  return NextResponse.json({
    statusCounts,
    gmailChannels: gmailChannels.map((channel) => ({
      id: channel.id,
      ...channel.gmailCredential,
    })),
  })
}
