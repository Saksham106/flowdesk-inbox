import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// POST /api/contacts — create or update a contact, and link it to a conversation
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json();
  const name = typeof payload?.name === "string" ? payload.name.trim() : "";
  const phoneE164 = typeof payload?.phoneE164 === "string" ? payload.phoneE164.trim() : "";
  const conversationId = typeof payload?.conversationId === "string" ? payload.conversationId : null;

  if (!name || !phoneE164) {
    return NextResponse.json({ error: "name and phoneE164 are required" }, { status: 400 });
  }

  const contact = await prisma.contact.upsert({
    where: {
      tenantId_phoneE164: {
        tenantId: session.user.tenantId,
        phoneE164,
      },
    },
    update: { name },
    create: {
      tenantId: session.user.tenantId,
      name,
      phoneE164,
    },
  });

  // Link to the conversation if provided
  if (conversationId) {
    await prisma.conversation.updateMany({
      where: { id: conversationId, tenantId: session.user.tenantId },
      data: { contactId: contact.id },
    });
  }

  return NextResponse.json({ contact });
}
