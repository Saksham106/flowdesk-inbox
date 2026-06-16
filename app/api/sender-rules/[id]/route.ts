import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = session.user.tenantId;
  const payload = await request.json();
  const action = payload?.action;

  if (action !== "accept" && action !== "dismiss") {
    return NextResponse.json({ error: "action must be 'accept' or 'dismiss'" }, { status: 400 });
  }

  const rule = await prisma.senderRule.findFirst({
    where: { id: params.id, tenantId },
  });

  if (!rule) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.senderRule.update({
    where: { id: params.id },
    data: { status: action === "accept" ? "active" : "dismissed" },
  });

  return NextResponse.json({ ok: true });
}
