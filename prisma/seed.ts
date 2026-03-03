import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const tenantName = process.env.SEED_TENANT_NAME ?? "Flowdesk Inbox";
  const email = process.env.SEED_EMAIL ?? "owner@flowdesk-inbox.local";
  const password = process.env.SEED_PASSWORD ?? "password123";
  const phoneNumberE164 = process.env.TWILIO_PHONE_NUMBER;

  if (!phoneNumberE164) {
    throw new Error("TWILIO_PHONE_NUMBER env var is required to seed the channel.");
  }

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

  await prisma.channel.upsert({
    where: { phoneNumberE164 },
    update: { tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      type: "sms",
      provider: "twilio",
      phoneNumberE164,
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
