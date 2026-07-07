import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { AUTOMATION_LEVEL_DEFAULT } from "@/lib/agent/automation-level";

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

  const { email, password, tenantName } = body as {
    email?: string;
    password?: string;
    tenantName?: string;
  };

  if (!email || !EMAIL_REGEX.test(email)) {
    return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
  }

  if (!password || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  // B2C: no account-type choice at signup. Everyone starts on the clean baseline
  // (Sales & CRM mode off); it can be enabled later in Settings.

  const localPart = email.split("@")[0].replace(/[^a-z0-9_-]/gi, "").toLowerCase();
  const resolvedTenantName =
    tenantName?.trim() || `${localPart}-${randomSuffix()}`;

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: resolvedTenantName,
          salesCrmEnabled: false,
        },
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email,
          passwordHash,
        },
      });

      // Explicit rather than relying on the schema default: a tenant missing
      // its AutopilotSetting row falls back to legacy Level 3 (Gmail drafts)
      // in getAutomationLevel, so signup must always create the row at the
      // new-tenant default Level 2 (labels only).
      await tx.autopilotSetting.create({
        data: {
          tenantId: tenant.id,
          enabled: false,
          automationLevel: AUTOMATION_LEVEL_DEFAULT,
        },
      });

      await tx.followUpSetting.create({
        data: {
          tenantId: tenant.id,
          enabled: false,
        },
      });

      return { userId: user.id, tenantId: tenant.id, salesCrmEnabled: tenant.salesCrmEnabled };
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
