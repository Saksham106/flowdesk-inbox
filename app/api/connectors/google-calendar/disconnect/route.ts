import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { email } = await request.json();
  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const cred = await prisma.googleCalendarCredential.findUnique({
    where: { tenantId_email: { tenantId: session.user.tenantId, email } },
  });

  if (!cred) {
    return NextResponse.json({ error: "Credential not found" }, { status: 404 });
  }

  await prisma.googleCalendarCredential.delete({
    where: { tenantId_email: { tenantId: session.user.tenantId, email } },
  });

  return NextResponse.json({ ok: true });
}
