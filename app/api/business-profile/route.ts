import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/business-profile — fetch tenant's business profile (returns null if not set yet)
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await prisma.businessProfile.findUnique({
    where: { tenantId: session.user.tenantId },
  });

  return NextResponse.json({ profile });
}

// PATCH /api/business-profile — upsert business profile fields
export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = session.user.tenantId;
  const body = await request.json();

  // Destructure only allowed fields to prevent mass-assignment
  const {
    businessName,
    industry,
    timezone,
    defaultTone,
    businessHoursJson,
    bookingPolicy,
    escalationPolicy,
  } = body as {
    businessName?: string;
    industry?: string;
    timezone?: string;
    defaultTone?: string;
    businessHoursJson?: unknown;
    bookingPolicy?: string;
    escalationPolicy?: string;
  };

  // Fix 3: Allow partial updates — only require businessName when creating a new profile
  // Build updateData from only the fields present in the request body
  const updateData: Record<string, unknown> = {};
  if (businessName !== undefined) {
    if (typeof businessName !== "string" || !businessName.trim()) {
      return NextResponse.json({ error: "businessName must be a non-empty string" }, { status: 400 });
    }
    updateData.businessName = businessName.trim();
  }
  if (industry !== undefined) updateData.industry = industry;
  if (timezone !== undefined) updateData.timezone = timezone;
  if (defaultTone !== undefined) updateData.defaultTone = defaultTone;
  if (businessHoursJson !== undefined) updateData.businessHoursJson = businessHoursJson;
  if (bookingPolicy !== undefined) updateData.bookingPolicy = bookingPolicy;
  if (escalationPolicy !== undefined) updateData.escalationPolicy = escalationPolicy;

  // If creating a new profile, businessName is required
  const existing = await prisma.businessProfile.findUnique({ where: { tenantId } });
  if (!existing && !updateData.businessName) {
    return NextResponse.json(
      { error: "businessName is required when creating a new profile" },
      { status: 400 }
    );
  }

  // Fix 1: Wrap upsert + auditLog in a $transaction
  // Fix 2: Log sanitized updateData instead of raw body
  const [profile] = await prisma.$transaction([
    prisma.businessProfile.upsert({
      where: { tenantId },
      update: updateData,
      create: { tenantId, ...(updateData as { businessName: string }) },
    }),
    prisma.auditLog.create({
      data: {
        tenantId,
        userId: session.user.id,
        action: "business_profile.upsert",
        payloadJson: updateData as Record<string, string>,
      },
    }),
  ]);

  return NextResponse.json({ profile });
}
