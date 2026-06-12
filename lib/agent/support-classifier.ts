const SUPPORT_PATTERN =
  /\b(not working|broken|issue|problem|bug|glitch|error|complaint|refund|still waiting|never received|keep getting|frustrated|unacceptable|worst|terrible)\b/i

const CHURN_PATTERN =
  /\b(cancel|cancellation|unsubscribe|quit|leave|switching|going elsewhere|competitor|disappointed|done with)\b/i

const SENSITIVE_PATTERN =
  /\b(legal|lawsuit|attorney|tax|medical|doctor|diagnosis|angry|furious|dispute|contract|hr|employment)\b/i

export type SupportSignals = {
  isSupport: boolean
  churnRisk: boolean
  needsEscalation: boolean
  suggestedKbDocId: string | null
}

export type SupportClassifierMessage = {
  direction: string
  body: string
}

export type SupportClassifierKbDoc = {
  id: string
  title: string
  content: string
}

export function classifySupportSignals(
  messages: SupportClassifierMessage[],
  kbDocs: SupportClassifierKbDoc[],
  label?: string | null
): SupportSignals {
  const bodyText = messages.map((m) => m.body).join("\n")
  const lastInbound = [...messages].reverse().find((m) => m.direction === "inbound")

  const isSupport = label === "Support" || SUPPORT_PATTERN.test(bodyText)
  const hasChurnLanguage = CHURN_PATTERN.test(bodyText)
  const churnRisk = isSupport && hasChurnLanguage
  const needsEscalation = churnRisk && SENSITIVE_PATTERN.test(bodyText)

  let suggestedKbDocId: string | null = null
  if (lastInbound && kbDocs.length > 0) {
    const queryWords = new Set(
      lastInbound.body
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3)
    )

    let bestScore = 0
    for (const doc of kbDocs) {
      const docWords = new Set(
        (doc.title + " " + doc.content)
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length > 3)
      )
      const overlap = [...queryWords].filter((w) => docWords.has(w)).length
      if (overlap >= 3 && overlap > bestScore) {
        bestScore = overlap
        suggestedKbDocId = doc.id
      }
    }
  }

  return { isSupport, churnRisk, needsEscalation, suggestedKbDocId }
}
