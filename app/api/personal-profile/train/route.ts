import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { trainLearnedReplyProfile } from "@/lib/agent/reply-learning";

export const runtime = "nodejs";

export async function POST() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = session.user.tenantId;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { accountType: true },
  });

  const channel = await prisma.channel.findFirst({
    where: { tenantId, type: "email" },
  });

  if (!channel) {
    return NextResponse.json(
      { error: "A connected email channel is required to train your reply style." },
      { status: 400 }
    );
  }

  let training: Awaited<ReturnType<typeof trainLearnedReplyProfile>>;
  try {
    training = await trainLearnedReplyProfile({
      tenantId,
      channelId: channel.id,
      profileType: tenant?.accountType === "personal" ? "personal" : "business",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to train reply style";
    const status = message.includes("OPENAI_API_KEY") ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }

  const profile = await prisma.learnedReplyProfile.findFirst({
    where: { id: training.profileId, tenantId },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      userId: session.user.id,
      action: "reply_learning.trained",
      payloadJson: {
        sampleCount: training.sampleCount,
        profileId: training.profileId,
        accountType: tenant?.accountType ?? "business",
      },
    },
  });

  return NextResponse.json({ profile });
}
