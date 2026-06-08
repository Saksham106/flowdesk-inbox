import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { VALID_SOURCE_TYPES } from "@/lib/knowledge-document-types";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const doc = await prisma.knowledgeDocument.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
  });

  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const payload = await request.json();
  const { title, sourceType, content } = payload ?? {};

  if (title !== undefined && (typeof title !== "string" || title.trim() === "")) {
    return NextResponse.json({ error: "Title cannot be empty" }, { status: 400 });
  }

  if (sourceType !== undefined && !VALID_SOURCE_TYPES.includes(sourceType)) {
    return NextResponse.json({ error: "Invalid sourceType" }, { status: 400 });
  }

  const updated = await prisma.knowledgeDocument.update({
    where: { id: params.id },
    data: {
      ...(title !== undefined ? { title: title.trim() } : {}),
      ...(sourceType !== undefined ? { sourceType } : {}),
      ...(content !== undefined ? { content } : {}),
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const doc = await prisma.knowledgeDocument.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
  });

  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.knowledgeDocument.delete({ where: { id: params.id } });

  return NextResponse.json({ ok: true });
}
