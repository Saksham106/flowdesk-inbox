import Twilio from "twilio";

export function getTwilioClient(
  accountSid?: string | null,
  authToken?: string | null
) {
  const sid = accountSid ?? process.env.TWILIO_ACCOUNT_SID;
  const token = authToken ?? process.env.TWILIO_AUTH_TOKEN;

  if (!sid || !token) {
    throw new Error("Twilio credentials are not configured.");
  }

  return Twilio(sid, token);
}

export function getTwilioAuthToken(overrides?: string | null) {
  return overrides ?? process.env.TWILIO_AUTH_TOKEN ?? "";
}
