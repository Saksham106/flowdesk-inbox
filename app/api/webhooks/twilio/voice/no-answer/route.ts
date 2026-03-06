import { NextResponse } from "next/server";
import { validateRequest } from "twilio";

import { prisma } from "@/lib/prisma";
import { getTwilioAuthToken, getTwilioClient } from "@/lib/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MISSED_CALL_REPLY =
  "Sorry we missed your call! Reply here and we'll get back to you shortly.";

// Twilio DialCallStatus values that mean the office did not answer
const UNANSWERED_STATUSES = new Set(["no-answer", "busy", "failed", "canceled"]);

function twimlResponse() {
  return new Response("<Response></Response>", {
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
  const callSid = params.CallSid ?? "";
  const dialCallStatus = params.DialCallStatus ?? "";

  const channel = await prisma.channel.findFirst({
    where: { phoneNumberE164: to },
  });

  // Validate Twilio signature using PUBLIC_WEBHOOK_BASE_URL
  const baseUrl = process.env.PUBLIC_WEBHOOK_BASE_URL ?? "";
  const signatureUrl = `${baseUrl}/api/webhooks/twilio/voice/no-answer`;
  const signature = request.headers.get("x-twilio-signature") ?? "";
  const authToken = getTwilioAuthToken(channel?.twilioAuthTokenEncrypted);

  const isValid = validateRequest(authToken, signature, signatureUrl, params);
  if (!isValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Call was answered — nothing to do
  if (!UNANSWERED_STATUSES.has(dialCallStatus)) {
    return twimlResponse();
  }

  if (!channel) {
    return twimlResponse();
  }

  // ── Idempotency check ──────────────────────────────────────────────────────
  // AuditLog already has a row for this callSid → Twilio retry, skip auto-text.
  const existingLog = await prisma.auditLog.findFirst({
    where: {
      tenantId: channel.tenantId,
      action: "missed_call_auto_text",
      payloadJson: {
        path: ["callSid"],
        equals: callSid,
      },
    },
  });

  if (existingLog) {
    console.log(`[voice/no-answer] Duplicate callSid ${callSid} — skipping.`);
    return twimlResponse();
  }

  // ── Send auto-text ─────────────────────────────────────────────────────────
  const replyText = channel.missedCallReplyText ?? DEFAULT_MISSED_CALL_REPLY;

  try {
    const client = getTwilioClient(channel.twilioAccountSid, channel.twilioAuthTokenEncrypted);
    await client.messages.create({
      from: to,   // Twilio number (the business's number)
      to: from,   // The caller's number
      body: replyText,
    });
  } catch (err) {
    console.error("[voice/no-answer] Failed to send auto-text:", err);
    // Still write the AuditLog so we don't retry infinitely on SMS failure
  }

  // ── Log for idempotency ────────────────────────────────────────────────────
  await prisma.auditLog.create({
    data: {
      tenantId: channel.tenantId,
      action: "missed_call_auto_text",
      payloadJson: {
        callSid,
        from,
        to,
        dialCallStatus,
        replyText,
      },
    },
  });

  return twimlResponse();
}
