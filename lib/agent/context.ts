import { prisma } from '@/lib/prisma'
import type { BusinessProfile, KnowledgeDocument } from '@prisma/client'

/**
 * Retrieves the tenant's business profile. Returns null if not configured.
 * The AI uses this for tone, timezone, and policy context.
 */
export async function getBusinessProfile(tenantId: string): Promise<BusinessProfile | null> {
  return prisma.businessProfile.findUnique({ where: { tenantId } })
}

/**
 * Searches knowledge documents by keyword match on title and content.
 * Simple case-insensitive substring search — no vector search yet.
 * Returns up to 10 most relevant documents.
 */
export async function searchKnowledgeBase(
  tenantId: string,
  query: string
): Promise<KnowledgeDocument[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  return prisma.knowledgeDocument.findMany({
    where: {
      tenantId,
      OR: [
        { title: { contains: trimmed, mode: 'insensitive' } },
        { content: { contains: trimmed, mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })
}

/**
 * Returns the full business context needed to construct an AI prompt:
 * the business profile + all knowledge documents for the tenant.
 * Used by the AI draft pipeline in Sprint 4.
 */
export async function getFullBusinessContext(tenantId: string): Promise<{
  profile: BusinessProfile | null
  documents: KnowledgeDocument[]
}> {
  const [profile, documents] = await Promise.all([
    getBusinessProfile(tenantId),
    prisma.knowledgeDocument.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ])
  return { profile, documents }
}
