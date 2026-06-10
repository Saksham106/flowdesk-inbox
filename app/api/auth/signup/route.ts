import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { email, password, accountType, tenantName } = body as {
    email?: string;
    password?: string;
    accountType?: string;
    tenantName?: string;
  };

  if (!email || !EMAIL_REGEX.test(email)) {
    return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
  }

  if (!password || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  if (accountType !== "personal" && accountType !== "business") {
    return NextResponse.json(
      { error: "accountType must be 'personal' or 'business'." },
      { status: 400 }
    );
  }

  const localPart = email.split("@")[0].replace(/[^a-z0-9_-]/gi, "").toLowerCase();
  const resolvedTenantName =
    tenantName?.trim() || `${localPart}-${randomSuffix()}`;

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: resolvedTenantName,
          accountType: accountType as "personal" | "business",
        },
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email,
          passwordHash,
        },
      });

      await tx.autopilotSetting.create({
        data: {
          tenantId: tenant.id,
          enabled: false,
        },
      });

      await tx.followUpSetting.create({
        data: {
          tenantId: tenant.id,
          enabled: false,
        },
      });

      return { userId: user.id, tenantId: tenant.id, accountType: tenant.accountType };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    // Prisma unique constraint violation code
    if (message.includes("Unique constraint") || message.includes("unique constraint")) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 }
      );
    }
    // Also catch Prisma error code P2002
    const errCode = (err as { code?: string }).code;
    if (errCode === "P2002") {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 }
      );
    }
    throw err;
  }
}
