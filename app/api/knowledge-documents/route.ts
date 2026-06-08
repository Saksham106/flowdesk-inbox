import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const documents = await prisma.knowledgeDocument.findMany({
    where: { tenantId: session.user.tenantId },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(documents)
}

export async function POST(req: NextRequest) {
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

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  const sourceType = typeof body.sourceType === 'string' ? body.sourceType : 'manual'

  if (!title || !content) {
    return NextResponse.json({ error: 'title and content are required' }, { status: 400 })
  }

  const document = await prisma.knowledgeDocument.create({
    data: {
      tenantId: session.user.tenantId,
      title,
      content,
      sourceType,
    },
  })

  return NextResponse.json(document, { status: 201 })
}
