import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptString } from "@/lib/crypto";
import { getStaffToken } from "@/lib/mindbody";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.MINDBODY_API_KEY) {
    return NextResponse.json({ error: "MINDBODY_API_KEY is not configured" }, { status: 503 });
  }

  const { siteId, username, password } = await request.json();
  if (!siteId || !username || !password) {
    return NextResponse.json({ error: "siteId, username, and password are required" }, { status: 400 });
  }

  // Verify credentials work before storing
  try {
    await getStaffToken(String(siteId), username, password);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid credentials";
    return NextResponse.json({ error: `Could not connect to MindBody: ${message}` }, { status: 400 });
  }

  await prisma.mindBodyCredential.upsert({
    where: { tenantId: session.user.tenantId },
    create: {
      tenantId: session.user.tenantId,
      siteId: String(siteId),
      usernameEncrypted: encryptString(username),
      passwordEncrypted: encryptString(password),
    },
    update: {
      siteId: String(siteId),
      usernameEncrypted: encryptString(username),
      passwordEncrypted: encryptString(password),
    },
  });

  return NextResponse.json({ ok: true });
}
