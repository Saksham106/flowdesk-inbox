import Twilio from "twilio";
import { decryptString } from "@/lib/crypto";

export function getTwilioClient(
  accountSid?: string | null,
  encryptedAuthToken?: string | null
) {
  const sid = accountSid ?? process.env.TWILIO_ACCOUNT_SID;
  const rawToken = encryptedAuthToken ?? process.env.TWILIO_AUTH_TOKEN;

  if (!sid || !rawToken) {
    throw new Error("Twilio credentials are not configured.");
  }

  const token = decryptString(rawToken);
  return Twilio(sid, token);
}

export function getTwilioAuthToken(encryptedOverride?: string | null): string {
  const raw = encryptedOverride ?? process.env.TWILIO_AUTH_TOKEN ?? "";
  return decryptString(raw);
}
