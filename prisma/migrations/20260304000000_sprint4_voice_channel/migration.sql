-- Add voice/call-forwarding fields to Channel
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "officePhoneE164" TEXT;
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "missedCallReplyText" TEXT;
