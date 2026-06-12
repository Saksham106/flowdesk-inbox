// lib/agent/sales-classifier.ts
const BUDGET_PATTERN =
  /\b(budget|pricing|price|cost|investment|per month|per year|annually|how much)\b/i

const TIMELINE_PATTERN =
  /\b(asap|urgent|this week|next week|this month|next month|this quarter|end of month|end of quarter|deadline|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i

const CLOSING_PATTERN =
  /\b(ready to sign|send (the )?contract|move forward|purchase order|ready to proceed|let's go ahead|we'd like to go ahead)\b/i

const PROPOSAL_PATTERN =
  /\b(proposal|scope of work|pricing breakdown|statement of work|send (me |us )?(a )?(quote|proposal))\b/i

const QUALIFICATION_PATTERN =
  /\b(evaluating|shortlisted|on our shortlist|budget approved|decision maker|comparing options|final decision)\b/i

export type SalesSignals = {
  isSalesLead: boolean
  extractedBudget: string | null
  extractedTimeline: string | null
  closingStage: "prospect" | "qualified" | "proposal" | "closing" | null
  suggestedAction: string
}

export const SALES_SUGGESTED_ACTIONS: Record<
  "prospect" | "qualified" | "proposal" | "closing",
  string
> = {
  prospect: "Send intro deck and ask about their timeline",
  qualified: "Schedule a discovery call to confirm budget and requirements",
  proposal: "Follow up on the proposal and offer to answer questions",
  closing: "Send the contract and confirm next steps",
}

export function classifySalesSignals(
  messages: { direction: string; body: string }[]
): SalesSignals {
  if (messages.length === 0) {
    return { isSalesLead: false, extractedBudget: null, extractedTimeline: null, closingStage: null, suggestedAction: "" }
  }

  const bodyText = messages.map((m) => m.body).join("\n")

  const budgetMatch = bodyText.match(/\$[\d,]+|\$\d+/)
  const extractedBudget = budgetMatch ? budgetMatch[0] : null

  const timelineMatch = bodyText.match(TIMELINE_PATTERN)
  const extractedTimeline = timelineMatch ? timelineMatch[0] : null

  let closingStage: SalesSignals["closingStage"] = null

  if (CLOSING_PATTERN.test(bodyText)) {
    closingStage = "closing"
  } else if (PROPOSAL_PATTERN.test(bodyText)) {
    closingStage = "proposal"
  } else if (QUALIFICATION_PATTERN.test(bodyText)) {
    closingStage = "qualified"
  } else if (BUDGET_PATTERN.test(bodyText)) {
    closingStage = "prospect"
  }

  if (!closingStage) {
    return { isSalesLead: false, extractedBudget: null, extractedTimeline: null, closingStage: null, suggestedAction: "" }
  }

  return {
    isSalesLead: true,
    extractedBudget,
    extractedTimeline,
    closingStage,
    suggestedAction: SALES_SUGGESTED_ACTIONS[closingStage],
  }
}
