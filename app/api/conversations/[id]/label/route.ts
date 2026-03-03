import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const VALID_LABELS = ["Lead", "Reschedule", "Pricing", "Complaint"] as const;

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json();
  // null clears the label
  const label: string | null =
    payload?.label === null ? null : typeof payload?.label === "string" ? payload.label : undefined;

  if (label !== null && label !== undefined && !VALID_LABELS.includes(label as typeof VALID_LABELS[number])) {
    return NextResponse.json({ error: "Invalid label" }, { status: 400 });
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.conversation.update({
    where: { id: params.id },
    data: { label: label ?? null },
  });

  return NextResponse.json({ ok: true });
}
