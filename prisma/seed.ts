import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { encryptString } from "../lib/crypto";

const prisma = new PrismaClient();

async function main() {
  const tenantName = process.env.SEED_TENANT_NAME ?? "Flowdesk Inbox";
  const email = process.env.SEED_EMAIL ?? "owner@flowdesk-inbox.local";
  const password = process.env.SEED_PASSWORD ?? "password123";

  // Twilio vars are deferred — only seed an SMS channel when TWILIO_PHONE_NUMBER is provided.
  const phoneNumberE164 = process.env.TWILIO_PHONE_NUMBER ?? null;
  const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID ?? null;
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN ?? null;
  const officePhoneE164 = process.env.OFFICE_PHONE_NUMBER ?? null;
  const missedCallReplyText = process.env.MISSED_CALL_REPLY_TEXT ?? null;

  const passwordHash = await bcrypt.hash(password, 10);

  const tenant = await prisma.tenant.upsert({
    where: { name: tenantName },
    update: {},
    create: { name: tenantName },
  });

  await prisma.user.upsert({
    where: { email },
    update: { tenantId: tenant.id, passwordHash },
    create: {
      email,
      passwordHash,
      tenantId: tenant.id,
    },
  });

  // Only seed the SMS channel when Twilio is configured.
  if (phoneNumberE164) {
    // Encrypt auth token if ENCRYPTION_SECRET is available; warn + store plaintext otherwise.
    let twilioAuthTokenEncrypted: string | null = null;
    if (twilioAuthToken) {
      twilioAuthTokenEncrypted = encryptString(twilioAuthToken);
    }

    await prisma.channel.upsert({
      where: { phoneNumberE164 },
      update: {
        tenantId: tenant.id,
        ...(twilioAccountSid && { twilioAccountSid }),
        ...(twilioAuthTokenEncrypted && { twilioAuthTokenEncrypted }),
        ...(officePhoneE164 !== undefined && { officePhoneE164 }),
        ...(missedCallReplyText !== undefined && { missedCallReplyText }),
      },
      create: {
        tenantId: tenant.id,
        type: "sms",
        provider: "twilio",
        phoneNumberE164,
        twilioAccountSid,
        twilioAuthTokenEncrypted,
        officePhoneE164,
        missedCallReplyText,
      },
    });

    console.log("Seeded SMS channel:", phoneNumberE164);
  } else {
    console.log(
      "TWILIO_PHONE_NUMBER not set — skipping SMS channel seed. " +
        "Connect Gmail via /settings to create an email channel."
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
