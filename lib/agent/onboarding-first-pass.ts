import { prisma } from "@/lib/prisma"
import { reconcileLabelsForChannel } from "@/lib/agent/email-label-reconcile"
import { getAutomationLevel, isActionAllowedAtLevel, MIN_LEVEL_FOR_ACTION } from "@/lib/agent/automation-level"
import { isFlowDeskGmailLabelName } from "@/lib/email-labels"

// Onboarding first-pass: the moment a user connects Gmail, classify and label a
// batch of their EXISTING inbox threads so their real inbox is visibly
// organized in the first session — instead of the pipeline only acting on new
// mail as it arrives and leaving the backlog untouched. Reuses the same
// reconcile path as the "Fix Gmail labels" button; the classifier is
// deterministic, so this backlog pass costs no LLM spend.
//
// Bounded to the recent inbox (the goal is "your inbox is organized now", not a
// full-history catch-up — that's what the relabel button is for) and safe to
// re-run: reconcile upserts writeback rows and projection is idempotent.
const ONBOARDING_WINDOW_DAYS = 30
const ONBOARDING_BATCH_SIZE = 40
const SAMPLE_LIMIT = 6

export type OnboardingFirstPassSample = {
  conversationId: string
  from: string
  subject: string
  labels: string[]
}

export type OnboardingFirstPassResult = {
  hadEmailChannel: boolean
  belowAutomationLevel: boolean
  minAutomationLevel: number
  organizedCount: number
  byLabel: Record<string, number>
  samples: OnboardingFirstPassSample[]
  errors: number
}

function emptyResult(overrides: Partial<OnboardingFirstPassResult>): OnboardingFirstPassResult {
  return {
    hadEmailChannel: false,
    belowAutomationLevel: false,
    minAutomationLevel: MIN_LEVEL_FOR_ACTION.apply_gmail_labels,
    organizedCount: 0,
    byLabel: {},
    samples: [],
    errors: 0,
    ...overrides,
  }
}

function extractQueuedLabels(payloadJson: unknown): { conversationId: string; labels: string[] } | null {
  if (!payloadJson || typeof payloadJson !== "object" || Array.isArray(payloadJson)) return null
  const payload = payloadJson as Record<string, unknown>
  const conversationId = typeof payload.conversationId === "string" ? payload.conversationId : null
  if (!conversationId) return null
  const labels = Array.isArray(payload.labels)
    ? payload.labels.filter((l): l is string => typeof l === "string" && isFlowDeskGmailLabelName(l))
    : []
  return { conversationId, labels }
}

export async function runOnboardingFirstPass(tenantId: string): Promise<OnboardingFirstPassResult> {
  const channels = await prisma.channel.findMany({
    where: {
      tenantId,
      OR: [
        { provider: "google", gmailCredential: { isNot: null } },
        { provider: "microsoft", outlookCredential: { isNot: null } },
      ],
    },
    select: { id: true, tenantId: true, provider: true },
  })

  if (channels.length === 0) {
    return emptyResult({ hadEmailChannel: false })
  }

  // Labels are the first rung of the automation ladder; new tenants default to
  // the level that allows them, but a tenant that lowered their level below the
  // gate gets an honest "raise your level" message instead of a silent no-op.
  const automationLevel = await getAutomationLevel(tenantId)
  if (!isActionAllowedAtLevel(automationLevel, "apply_gmail_labels")) {
    return emptyResult({ hadEmailChannel: true, belowAutomationLevel: true })
  }

  // Capture the boundary before projecting so the proof summary reads only the
  // label writebacks this pass produced (each projection audits gmail.labels.queued).
  const startedAt = new Date()

  let errors = 0
  for (const channel of channels) {
    const result = await reconcileLabelsForChannel(channel, {
      windowDays: ONBOARDING_WINDOW_DAYS,
      batchSize: ONBOARDING_BATCH_SIZE,
    })
    errors += result.errors
  }

  const queuedAudits = await prisma.auditLog.findMany({
    where: {
      tenantId,
      action: { in: ["gmail.labels.queued", "outlook.labels.queued"] },
      createdAt: { gte: startedAt },
    },
    select: { payloadJson: true },
  })

  // A conversation can be re-projected more than once in a pass; keep the last
  // label set seen per conversation and only count those that received ≥1 label
  // (an empty set means "no FlowDesk label applies" — not something organized).
  const labelsByConversation = new Map<string, string[]>()
  for (const audit of queuedAudits) {
    const extracted = extractQueuedLabels(audit.payloadJson)
    if (extracted && extracted.labels.length > 0) {
      labelsByConversation.set(extracted.conversationId, extracted.labels)
    }
  }

  const byLabel: Record<string, number> = {}
  for (const labels of labelsByConversation.values()) {
    for (const label of labels) {
      byLabel[label] = (byLabel[label] ?? 0) + 1
    }
  }

  const sampleIds = Array.from(labelsByConversation.keys()).slice(0, SAMPLE_LIMIT)
  const sampleConversations = sampleIds.length
    ? await prisma.conversation.findMany({
        where: { id: { in: sampleIds }, tenantId },
        select: {
          id: true,
          contact: { select: { name: true } },
          messages: {
            where: { direction: "inbound" },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { fromE164: true, subject: true },
          },
        },
      })
    : []

  const samples: OnboardingFirstPassSample[] = sampleConversations.map((conv) => ({
    conversationId: conv.id,
    from: conv.contact?.name || conv.messages[0]?.fromE164 || "Unknown sender",
    subject: conv.messages[0]?.subject?.trim() || "(no subject)",
    labels: labelsByConversation.get(conv.id) ?? [],
  }))

  return emptyResult({
    hadEmailChannel: true,
    organizedCount: labelsByConversation.size,
    byLabel,
    samples,
    errors,
  })
}
