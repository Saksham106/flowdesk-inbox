import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify ownership before reading body (avoids parsing on mismatched tenant)
  const existing = await prisma.knowledgeDocument.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
  })

  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Use updateMany with tenantId scope to avoid TOCTOU race
  const result = await prisma.knowledgeDocument.updateMany({
    where: { id: params.id, tenantId: session.user.tenantId },
    data: {
      title: typeof body.title === 'string' ? body.title.trim() || existing.title : existing.title,
      content: typeof body.content === 'string' ? body.content.trim() || existing.content : existing.content,
      sourceType: typeof body.sourceType === 'string' ? body.sourceType : existing.sourceType,
    },
  })

  if (result.count === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const updated = await prisma.knowledgeDocument.findUnique({ where: { id: params.id } })
  return NextResponse.json(updated)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // deleteMany with tenantId scope: atomic ownership check + delete, no TOCTOU race
  const result = await prisma.knowledgeDocument.deleteMany({
    where: { id: params.id, tenantId: session.user.tenantId },
  })

  if (result.count === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
