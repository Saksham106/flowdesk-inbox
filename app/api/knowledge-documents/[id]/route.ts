import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isValidSourceType } from "@/lib/knowledge-document-types";
import { Prisma } from "@prisma/client";

// GET /api/knowledge-documents/[id] — fetch one document (must belong to tenant)
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const doc = await prisma.knowledgeDocument.findUnique({
    where: { id: params.id },
  });

  if (!doc || doc.tenantId !== session.user.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ document: doc });
}

// PATCH /api/knowledge-documents/[id] — update a document (must belong to tenant)
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = session.user.tenantId;

  const doc = await prisma.knowledgeDocument.findUnique({
    where: { id: params.id },
  });

  if (!doc || doc.tenantId !== tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const { title, content, sourceType } = body as {
    title?: string;
    content?: string;
    sourceType?: string;
  };

  // Fix 4: Validate non-empty title/content when present
  if (title !== undefined) {
    if (typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "title must be a non-empty string" }, { status: 400 });
    }
  }
  if (content !== undefined) {
    if (typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "content must be a non-empty string" }, { status: 400 });
    }
  }
  if (sourceType !== undefined && !isValidSourceType(sourceType)) {
    return NextResponse.json({ error: "Invalid sourceType" }, { status: 400 });
  }

  // Fix 5: Remove explicit updatedAt — Prisma @updatedAt handles this automatically
  const updateData: Record<string, unknown> = {};
  if (title !== undefined) updateData.title = title.trim();
  if (content !== undefined) updateData.content = content.trim();
  if (sourceType !== undefined) updateData.sourceType = sourceType;

  // Fix 5: Guard against vacuous no-op PATCHes
  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // Fix 1: Wrap update + auditLog in $transaction
  // Fix 6: Handle P2025 (record deleted between find and update)
  let updated: Awaited<ReturnType<typeof prisma.knowledgeDocument.update>>;
  try {
    [updated] = await prisma.$transaction([
      prisma.knowledgeDocument.update({
        where: { id: params.id },
        data: updateData,
      }),
      prisma.auditLog.create({
        data: {
          tenantId,
          userId: session.user.id,
          action: "knowledge_document.update",
          payloadJson: { documentId: params.id, ...updateData },
        },
      }),
    ]);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    throw err;
  }

  return NextResponse.json({ document: updated });
}

// DELETE /api/knowledge-documents/[id] — delete a document (must belong to tenant)
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = session.user.tenantId;

  const doc = await prisma.knowledgeDocument.findUnique({
    where: { id: params.id },
  });

  if (!doc || doc.tenantId !== tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Fix 1: Wrap delete + auditLog in $transaction
  // Fix 6: Handle P2025 (record deleted between find and delete)
  try {
    await prisma.$transaction([
      prisma.knowledgeDocument.delete({
        where: { id: params.id },
      }),
      prisma.auditLog.create({
        data: {
          tenantId,
          userId: session.user.id,
          action: "knowledge_document.delete",
          payloadJson: { documentId: params.id },
        },
      }),
    ]);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true });
}
