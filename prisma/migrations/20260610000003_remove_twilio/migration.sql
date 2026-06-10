-- Remove Twilio-specific columns from Channel (decision: 2026-06-10, not using Twilio)
ALTER TABLE "Channel" DROP COLUMN IF EXISTS "phoneNumberE164";
ALTER TABLE "Channel" DROP COLUMN IF EXISTS "twilioAccountSid";
ALTER TABLE "Channel" DROP COLUMN IF EXISTS "twilioAuthTokenEncrypted";
ALTER TABLE "Channel" DROP COLUMN IF EXISTS "officePhoneE164";
ALTER TABLE "Channel" DROP COLUMN IF EXISTS "missedCallReplyText";

-- Update Channel defaults to email/google since SMS/Twilio are removed
ALTER TABLE "Channel" ALTER COLUMN "type" SET DEFAULT 'email';
ALTER TABLE "Channel" ALTER COLUMN "provider" SET DEFAULT 'google';
