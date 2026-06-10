import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { Prisma } from "@prisma/client";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// GET /api/personal-profile — fetch tenant's personal profile (returns null if not set yet)
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await prisma.personalProfile.findUnique({
    where: { tenantId: session.user.tenantId },
  });

  return NextResponse.json({ profile });
}

// PATCH /api/personal-profile — upsert personal profile fields
export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = session.user.tenantId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    toneSummary,
    greetingPatterns,
    signoffPatterns,
    sentenceLengthStyle,
    formalityLevel,
    recurringPhrasesToUse,
    recurringPhrasesToAvoid,
    sanitizedExamples,
  } = body as {
    toneSummary?: string;
    greetingPatterns?: string;
    signoffPatterns?: string;
    sentenceLengthStyle?: string;
    formalityLevel?: string;
    recurringPhrasesToUse?: string[];
    recurringPhrasesToAvoid?: string[];
    sanitizedExamples?: string;
  };

  const updateData: Record<string, unknown> = {};
  if (toneSummary !== undefined) updateData.toneSummary = toneSummary;
  if (greetingPatterns !== undefined) updateData.greetingPatterns = greetingPatterns;
  if (signoffPatterns !== undefined) updateData.signoffPatterns = signoffPatterns;
  if (sentenceLengthStyle !== undefined) updateData.sentenceLengthStyle = sentenceLengthStyle;
  if (formalityLevel !== undefined) updateData.formalityLevel = formalityLevel;
  if (recurringPhrasesToUse !== undefined) {
    if (!Array.isArray(recurringPhrasesToUse)) {
      return NextResponse.json(
        { error: "recurringPhrasesToUse must be an array" },
        { status: 400 }
      );
    }
    updateData.recurringPhrasesToUse = recurringPhrasesToUse;
  }
  if (recurringPhrasesToAvoid !== undefined) {
    if (!Array.isArray(recurringPhrasesToAvoid)) {
      return NextResponse.json(
        { error: "recurringPhrasesToAvoid must be an array" },
        { status: 400 }
      );
    }
    updateData.recurringPhrasesToAvoid = recurringPhrasesToAvoid;
  }
  if (sanitizedExamples !== undefined) updateData.sanitizedExamples = sanitizedExamples;

  const [profile] = await prisma.$transaction([
    prisma.personalProfile.upsert({
      where: { tenantId },
      update: updateData,
      create: { ...(updateData as Prisma.PersonalProfileUncheckedCreateInput), tenantId },
    }),
    prisma.auditLog.create({
      data: {
        tenantId,
        userId: session.user.id,
        action: "personal_profile.upsert",
        payloadJson: updateData as Prisma.InputJsonValue,
      },
    }),
  ]);

  return NextResponse.json({ profile });
}
