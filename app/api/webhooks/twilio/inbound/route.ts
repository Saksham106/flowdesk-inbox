import { NextResponse } from "next/server";
import { validateRequest } from "twilio";

import { prisma } from "@/lib/prisma";
import { getTwilioAuthToken } from "@/lib/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildRequestUrl(request: Request) {
  const url = new URL(request.url);
  const protocol = request.headers.get("x-forwarded-proto") ?? url.protocol;
  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    url.host;

  return `${protocol.replace(":", "")}://${host}${url.pathname}${url.search}`;
}

function emptyTwimlResponse() {
  return new Response("<Response></Response>", {
    status: 200,
    headers: {
      "Content-Type": "text/xml",
    },
  });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const params: Record<string, string> = {};

  for (const [key, value] of formData.entries()) {
    params[key] = value.toString();
  }

  const from = params.From ?? "";
  const to = params.To ?? "";
  const body = params.Body ?? "";
  const messageSid = params.MessageSid ?? "";

  const channel = await prisma.channel.findFirst({
    where: { phoneNumberE164: to },
  });

  const signature = request.headers.get("x-twilio-signature") ?? "";
  const authToken = getTwilioAuthToken(channel?.twilioAuthTokenEncrypted);
  const url = buildRequestUrl(request);

  const isValid = validateRequest(authToken, signature, url, params);

  if (!isValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (!channel) {
    return emptyTwimlResponse();
  }

  const now = new Date();

  const conversation = await prisma.conversation.upsert({
    where: {
      tenantId_channelId_externalThreadId: {
        tenantId: channel.tenantId,
        channelId: channel.id,
        externalThreadId: from,
      },
    },
    update: {
      lastMessageAt: now,
      status: "needs_reply",
    },
    create: {
      tenantId: channel.tenantId,
      channelId: channel.id,
      externalThreadId: from,
      status: "needs_reply",
      lastMessageAt: now,
    },
  });

  await prisma.$transaction([
    prisma.message.upsert({
      where: { providerMessageId: messageSid },
      update: {},
      create: {
        conversationId: conversation.id,
        direction: "inbound",
        fromE164: from,
        toE164: to,
        body,
        providerMessageId: messageSid,
        createdAt: now,
      },
    }),
    prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: now },
    }),
    prisma.draft.upsert({
      where: { conversationId: conversation.id },
      update: {},
      create: {
        conversationId: conversation.id,
        text: "",
        status: "none",
      },
    }),
  ]);

  return emptyTwimlResponse();
}
