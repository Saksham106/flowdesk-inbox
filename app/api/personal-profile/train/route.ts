import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generatePersonalStyleProfile } from "@/lib/ai/provider";

export const runtime = "nodejs";

export async function POST() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = session.user.tenantId;

  // Require a connected Gmail channel
  const channel = await prisma.channel.findFirst({
    where: { tenantId, type: "email" },
  });

  if (!channel) {
    return NextResponse.json(
      { error: "A connected Gmail channel is required to train your style profile." },
      { status: 400 }
    );
  }

  // Fetch recent outbound messages for this tenant (across all conversations)
  const tenantConversations = await prisma.conversation.findMany({
    where: { tenantId },
    select: { id: true },
  });

  const conversationIds = tenantConversations.map((c) => c.id);

  const messages = await prisma.message.findMany({
    where: {
      conversationId: { in: conversationIds },
      direction: "outbound",
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { body: true, createdAt: true },
  });

  if (messages.length < 5) {
    return NextResponse.json(
      { error: "Not enough sent messages to learn from. Send at least 5 emails first." },
      { status: 400 }
    );
  }

  let styleResult: Awaited<ReturnType<typeof generatePersonalStyleProfile>>;
  try {
    styleResult = await generatePersonalStyleProfile(messages);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate style profile";
    const status = message.includes("OPENAI_API_KEY") ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }

  const profile = await prisma.personalProfile.upsert({
    where: { tenantId },
    create: {
      tenantId,
      ...styleResult,
      lastTrainedAt: new Date(),
      sampleCount: messages.length,
    },
    update: {
      ...styleResult,
      lastTrainedAt: new Date(),
      sampleCount: messages.length,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      userId: session.user.id,
      action: "personal_profile.trained",
      payloadJson: {
        sampleCount: messages.length,
        profileId: profile.id,
      },
    },
  });

  return NextResponse.json({ profile });
}
