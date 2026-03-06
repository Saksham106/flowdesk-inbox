import { NextResponse } from "next/server";
import { validateRequest } from "twilio";

import { prisma } from "@/lib/prisma";
import { getTwilioAuthToken, getTwilioClient } from "@/lib/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MISSED_CALL_REPLY =
  "Sorry we missed your call! Reply here and we'll get back to you shortly.";

function twimlResponse(xml: string) {
  return new Response(xml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
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

  const channel = await prisma.channel.findFirst({
    where: { phoneNumberE164: to },
  });

  // Validate Twilio signature using PUBLIC_WEBHOOK_BASE_URL so it works in dev (ngrok) and prod.
  const baseUrl = process.env.PUBLIC_WEBHOOK_BASE_URL ?? "";
  const signatureUrl = `${baseUrl}/api/webhooks/twilio/voice`;
  const signature = request.headers.get("x-twilio-signature") ?? "";
  const authToken = getTwilioAuthToken(channel?.twilioAuthTokenEncrypted);

  const isValid = validateRequest(authToken, signature, signatureUrl, params);
  if (!isValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (!channel) {
    // Unknown number — just hang up silently
    return twimlResponse("<Response><Hangup/></Response>");
  }

  const publicBase = process.env.PUBLIC_WEBHOOK_BASE_URL ?? "";
  const noAnswerActionUrl = `${publicBase}/api/webhooks/twilio/voice/no-answer`;

  // If no office phone is configured, skip forwarding — auto-text immediately.
  if (!channel.officePhoneE164) {
    const replyText = channel.missedCallReplyText ?? DEFAULT_MISSED_CALL_REPLY;
    try {
      const client = getTwilioClient(channel.twilioAccountSid, channel.twilioAuthTokenEncrypted);
      await client.messages.create({
        from: to,
        to: from,
        body: replyText,
      });
    } catch (err) {
      console.error("[voice] Failed to send immediate auto-text:", err);
    }
    return twimlResponse(
      `<Response><Say>Sorry, we missed your call. We sent you a text to follow up.</Say><Hangup/></Response>`
    );
  }

  // Forward call to office phone. If no answer, Twilio POSTs to no-answer action URL.
  return twimlResponse(
    `<Response>` +
      `<Dial action="${noAnswerActionUrl}" timeout="20" callerId="${to}">` +
        `<Number>${channel.officePhoneE164}</Number>` +
      `</Dial>` +
    `</Response>`
  );
}
