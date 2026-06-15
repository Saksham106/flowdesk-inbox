import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { stopGmailWatch } from "@/lib/google";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { channelId } = await request.json();
  if (!channelId) {
    return NextResponse.json({ error: "channelId is required" }, { status: 400 });
  }

  // Verify this channel belongs to the session's tenant
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, tenantId: session.user.tenantId, type: "email" },
  });

  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  try {
    await stopGmailWatch(channelId);
  } catch (err) {
    console.warn("Failed to stop Gmail watch before disconnect", {
      channelId,
      message: err instanceof Error ? err.message : "Unknown stop watch error",
    });
  }

  // Delete channel (GmailCredential cascades automatically)
  await prisma.channel.delete({ where: { id: channelId } });

  return NextResponse.json({ ok: true });
}
