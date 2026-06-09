import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { syncGmailChannel } from "@/lib/google";

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

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, tenantId: session.user.tenantId, type: "email" },
  });

  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  try {
    const count = await syncGmailChannel(channelId, session.user.tenantId);

    await prisma.gmailCredential.update({
      where: { channelId },
      data: { lastSyncedAt: new Date(), lastSyncError: null },
    });

    return NextResponse.json({ ok: true, synced: count });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown sync error";

    await prisma.gmailCredential.update({
      where: { channelId },
      data: { lastSyncError: message },
    }).catch(() => {});

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
