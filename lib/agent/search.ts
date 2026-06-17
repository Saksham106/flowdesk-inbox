import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"

export type SearchResult = {
  id: string
  conversationId: string
  body: string
  direction: string
  createdAt: Date
  conversation: {
    id: string
    tenantId: string
    status: string
  }
}

export function buildTsQuery(query: string): string {
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)

  if (words.length === 0) return ""
  return words.map((w) => `${w}:*`).join(" & ")
}

export async function searchMessages(
  tenantId: string,
  query: string,
  limit = 20
): Promise<SearchResult[]> {
  const tsQuery = buildTsQuery(query)
  if (!tsQuery) return []

  const results = await prisma.$queryRaw<SearchResult[]>`
    SELECT
      m.id,
      m."conversationId",
      m.body,
      m.direction,
      m."createdAt",
      json_build_object(
        'id', c.id,
        'tenantId', c."tenantId",
        'status', c.status
      ) AS conversation
    FROM "Message" m
    JOIN "Conversation" c ON c.id = m."conversationId"
    WHERE c."tenantId" = ${tenantId}
      AND m."searchVector" @@ to_tsquery('english', ${tsQuery})
    ORDER BY ts_rank(m."searchVector", to_tsquery('english', ${tsQuery})) DESC
    LIMIT ${Prisma.raw(String(limit))}
  `

  return results
}
