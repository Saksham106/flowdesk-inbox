import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { VALID_SOURCE_TYPES } from "@/lib/knowledge-document-types";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json();
  const { title, sourceType, content } = payload ?? {};

  if (!title || typeof title !== "string" || title.trim() === "") {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  if (sourceType && !VALID_SOURCE_TYPES.includes(sourceType)) {
    return NextResponse.json({ error: "Invalid sourceType" }, { status: 400 });
  }

  const doc = await prisma.knowledgeDocument.create({
    data: {
      tenantId: session.user.tenantId,
      title: title.trim(),
      sourceType: sourceType ?? "faq",
      content: content ?? "",
    },
  });

  return NextResponse.json(doc, { status: 201 });
}
