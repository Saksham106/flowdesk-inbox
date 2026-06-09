import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { VALID_SOURCE_TYPES } from "@/lib/knowledge-document-types";

// GET /api/knowledge-documents — list all KnowledgeDocuments for the tenant
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const documents = await prisma.knowledgeDocument.findMany({
    where: { tenantId: session.user.tenantId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ documents });
}

// POST /api/knowledge-documents — create a new KnowledgeDocument
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = session.user.tenantId;
  const body = await request.json();

  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  const sourceType =
    typeof body?.sourceType === "string" ? body.sourceType.trim() : "faq";

  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  if (!content) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  if (!VALID_SOURCE_TYPES.includes(sourceType)) {
    return NextResponse.json({ error: "Invalid sourceType" }, { status: 400 });
  }

  // Fix 1: Wrap knowledgeDocument.create + auditLog.create in $transaction
  const [document] = await prisma.$transaction([
    prisma.knowledgeDocument.create({
      data: { tenantId, title, content, sourceType },
    }),
    prisma.auditLog.create({
      data: {
        tenantId,
        userId: session.user.id,
        action: "knowledge_document.create",
        payloadJson: { title, sourceType },
      },
    }),
  ]);

  return NextResponse.json({ document }, { status: 201 });
}
