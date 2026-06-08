import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const profile = await prisma.businessProfile.findUnique({
    where: { tenantId: session.user.tenantId },
  })

  if (!profile) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(profile)
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const businessName = typeof body.businessName === 'string' ? body.businessName : undefined
  const industry = typeof body.industry === 'string' ? body.industry : undefined
  const timezone = typeof body.timezone === 'string' ? body.timezone : undefined
  const defaultTone = typeof body.defaultTone === 'string' ? body.defaultTone : undefined
  // For nullable JSON fields, Prisma requires Prisma.JsonNull to set null explicitly
  const businessHoursJson: Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined =
    body.businessHoursJson === null
      ? Prisma.JsonNull
      : body.businessHoursJson !== undefined
        ? (body.businessHoursJson as Prisma.InputJsonValue)
        : undefined
  const bookingPolicy = typeof body.bookingPolicy === 'string' ? body.bookingPolicy : undefined
  const escalationPolicy = typeof body.escalationPolicy === 'string' ? body.escalationPolicy : undefined

  const profile = await prisma.businessProfile.upsert({
    where: { tenantId: session.user.tenantId },
    create: {
      tenantId: session.user.tenantId,
      businessName: businessName ?? 'My Business',
      industry: industry ?? 'med_spa',
      timezone: timezone ?? 'America/New_York',
      defaultTone: defaultTone ?? 'professional',
      businessHoursJson: businessHoursJson ?? undefined,
      bookingPolicy: bookingPolicy ?? undefined,
      escalationPolicy: escalationPolicy ?? undefined,
    },
    update: {
      ...(businessName !== undefined && { businessName }),
      ...(industry !== undefined && { industry }),
      ...(timezone !== undefined && { timezone }),
      ...(defaultTone !== undefined && { defaultTone }),
      ...(businessHoursJson !== undefined && { businessHoursJson }),
      ...(bookingPolicy !== undefined && { bookingPolicy }),
      ...(escalationPolicy !== undefined && { escalationPolicy }),
    },
  })

  // Log only known-safe fields, not the raw body, to avoid persisting arbitrary client data
  await prisma.auditLog.create({
    data: {
      tenantId: session.user.tenantId,
      userId: session.user.id ?? null,
      action: 'business_profile.upsert',
      payloadJson: { businessName, industry, timezone, defaultTone, bookingPolicy, escalationPolicy },
    },
  })

  return NextResponse.json(profile)
}
