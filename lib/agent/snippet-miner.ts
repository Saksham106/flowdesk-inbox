import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

// Extracts candidate phrases from a message body.
// Returns greetings, sign-offs, and common mid-body sentences.
function extractCandidates(body: string): string[] {
  const sentences = body
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10 && s.length < 200)

  const candidates: string[] = []

  // First sentence (greeting)
  if (sentences[0]) candidates.push(sentences[0])
  // Last sentence (sign-off)
  if (sentences.length > 1 && sentences[sentences.length - 1]) {
    candidates.push(sentences[sentences.length - 1])
  }
  // Mid-body sentences that look like templates
  for (let i = 1; i < sentences.length - 1; i++) {
    const s = sentences[i]
    if (/please|feel free|let me know|don't hesitate|happy to|reach out/i.test(s)) {
      candidates.push(s)
    }
  }

  return candidates
}

export async function mineSnippets(tenantId: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)

  const messages = await prisma.message.findMany({
    where: {
      conversation: { tenantId },
      direction: "outbound",
      createdAt: { gte: since },
    },
    select: { id: true, body: true },
    take: 500,
  })

  // Count phrase frequency
  const freq = new Map<string, { count: number; ids: string[] }>()
  for (const msg of messages) {
    const candidates = extractCandidates(msg.body)
    for (const phrase of candidates) {
      const key = phrase.toLowerCase().replace(/\s+/g, " ").trim()
      if (!freq.has(key)) freq.set(key, { count: 0, ids: [] })
      const entry = freq.get(key)!
      entry.count++
      entry.ids.push(msg.id)
    }
  }

  let created = 0
  const existing = await prisma.snippet.findMany({
    where: { tenantId },
    select: { title: true },
  })
  const existingTitles = new Set(existing.map((s) => s.title.toLowerCase()))

  for (const [key, { count, ids }] of freq.entries()) {
    if (count < 3) continue
    // Use the first 60 chars as title
    const title = key.charAt(0).toUpperCase() + key.slice(1, 60) + (key.length > 60 ? "…" : "")
    if (existingTitles.has(title.toLowerCase())) continue

    await prisma.snippet.upsert({
      where: { id: `mine-${tenantId}-${Buffer.from(key).toString("base64").slice(0, 20)}` },
      update: {},
      create: {
        id: `mine-${tenantId}-${Buffer.from(key).toString("base64").slice(0, 20)}`,
        tenantId,
        title,
        content: key.charAt(0).toUpperCase() + key.slice(1),
        status: "suggested",
        source: "mined",
        minedFromJson: ids.slice(0, 3) as Prisma.InputJsonValue,
      },
    })
    created++
  }

  return created
}

export type SnippetMineCronResult = {
  ok: boolean
  results: Record<string, number>
  failed: number
}

export async function runSnippetMineCron(): Promise<SnippetMineCronResult> {
  const tenants = await prisma.tenant.findMany({ select: { id: true } })
  const results: Record<string, number> = {}
  const errors: string[] = []
  for (const tenant of tenants) {
    try {
      results[tenant.id] = await mineSnippets(tenant.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error"
      console.error(`snippet-mine: failed for tenant ${tenant.id}: ${msg}`)
      errors.push(tenant.id)
    }
  }
  return { ok: errors.length === 0, results, failed: errors.length }
}
