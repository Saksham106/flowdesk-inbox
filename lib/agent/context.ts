import { prisma } from '@/lib/prisma'

/**
 * Fetch the BusinessProfile for the given tenant.
 * Returns null if no profile exists yet.
 */
export async function getBusinessProfile(tenantId: string) {
  return prisma.businessProfile.findUnique({
    where: { tenantId },
  })
}

/**
 * Full-text search (case-insensitive) over KnowledgeDocuments belonging to
 * the given tenant.  Always scopes by tenantId and limits to 10 results.
 */
export async function searchKnowledgeBase(tenantId: string, query: string) {
  return prisma.knowledgeDocument.findMany({
    where: {
      tenantId,
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { content: { contains: query, mode: 'insensitive' } },
      ],
    },
    take: 10,
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Returns both the BusinessProfile and the top-10 KnowledgeDocuments for a
 * tenant.  Useful as a single call to hydrate the agent context.
 */
export async function getFullBusinessContext(tenantId: string) {
  const [profile, documents] = await Promise.all([
    getBusinessProfile(tenantId),
    searchKnowledgeBase(tenantId, ''),
  ])
  return { profile, documents }
}
