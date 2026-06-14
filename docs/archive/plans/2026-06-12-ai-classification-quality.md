# AI Classification Quality & Account-Mode Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix reply-style learning (read from Gmail sent history), separate personal vs business AI prompts, prevent newsletters/notifications from being marked "Needs Reply", and align assistant context text with actual email type.

**Architecture:** New `lib/agent/email-classifier.ts` module (pure deterministic, mirrors `support-classifier.ts` pattern); `emailType` stored in `ConversationState.metadataJson`; `accountType` guard added to `work-item-sync.ts`; Gmail SENT fetch added to `lib/google.ts` used only at training time.

**Tech Stack:** TypeScript, Next.js, Prisma, Vitest, googleapis (already installed), OpenAI (existing classify path)

**Spec:** `docs/superpowers/specs/2026-06-12-ai-classification-quality-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/agent/email-classifier.ts` | CREATE | Pure deterministic email type detection |
| `lib/google.ts` | MODIFY | Add `fetchGmailSentSamples()` |
| `lib/agent/reply-learning.ts` | MODIFY | Fall back to Gmail SENT when DB < 5 samples |
| `app/settings/PersonalStylePanel.tsx` | MODIFY | Update training copy |
| `lib/ai/prompts/classify.ts` | MODIFY | Add `accountType` param + personal prompt variant |
| `lib/agent/jobs.ts` | MODIFY | Pass `accountType` into classify call |
| `lib/agent/work-item-sync.ts` | MODIFY | Account-type guard; store `emailType` in metadata |
| `lib/agent/command-center.ts` | MODIFY | Read `emailType`; override state for notifications/newsletters |
| `app/conversations/[id]/page.tsx` | MODIFY | Pass `conversationState` into `assistantInput`; suppress Handle This for no-reply emails |
| `tests/email-classifier.test.ts` | CREATE | Unit tests for classifier |
| `tests/command-center.test.ts` | MODIFY | Add `emailType` override cases |
| `tests/reply-learning.test.ts` | CREATE | Gmail SENT fallback tests |
| `tests/agent-job-pipeline.test.ts` | MODIFY | Personal-account prompt test |

---

## Task 1: Create `lib/agent/email-classifier.ts`

**Files:**
- Create: `lib/agent/email-classifier.ts`
- Create: `tests/email-classifier.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/email-classifier.test.ts
import { describe, expect, it } from "vitest"
import { classifyEmailType } from "@/lib/agent/email-classifier"

describe("classifyEmailType", () => {
  it("classifies no-reply sender as notification", () => {
    const result = classifyEmailType({
      fromEmail: "noreply@github.com",
      subject: "Your PR was merged",
      body: "Pull request #42 was merged into main.",
    })
    expect(result.emailType).toBe("notification")
  })

  it("classifies no-reply variant donotreply as notification", () => {
    const result = classifyEmailType({
      fromEmail: "donotreply@azure.microsoft.com",
      subject: "Build succeeded",
      body: "Your build completed successfully.",
    })
    expect(result.emailType).toBe("notification")
  })

  it("classifies known notification domain as notification", () => {
    const result = classifyEmailType({
      fromEmail: "support@porkbun.com",
      subject: "Domain renewal notice",
      body: "Your domain is up for renewal.",
    })
    expect(result.emailType).toBe("notification")
  })

  it("classifies Supabase email as notification", () => {
    const result = classifyEmailType({
      fromEmail: "notifications@supabase.io",
      subject: "Project health check",
      body: "Your Supabase project is healthy.",
    })
    expect(result.emailType).toBe("notification")
  })

  it("classifies GitHub subject pattern as notification", () => {
    const result = classifyEmailType({
      fromEmail: "alerts@some-ci.com",
      subject: "[GitHub] PR #123 opened by user",
      body: "Someone opened a pull request.",
    })
    expect(result.emailType).toBe("notification")
  })

  it("classifies Google Docs share subject as notification", () => {
    const result = classifyEmailType({
      fromEmail: "drive-shares-noreply@google.com",
      subject: "Alice shared a document with you",
      body: "Click to open the document.",
    })
    expect(result.emailType).toBe("notification")
  })

  it("classifies body with unsubscribe link as newsletter", () => {
    const result = classifyEmailType({
      fromEmail: "news@somecompany.com",
      subject: "Weekly digest",
      body: "Here are this week's updates. To unsubscribe click here.",
    })
    expect(result.emailType).toBe("newsletter")
  })

  it("classifies marketing subject pattern as marketing", () => {
    const result = classifyEmailType({
      fromEmail: "deals@store.com",
      subject: "50% off today only — limited time offer",
      body: "Don't miss this deal.",
    })
    expect(result.emailType).toBe("marketing")
  })

  it("classifies normal personal email as needs_reply", () => {
    const result = classifyEmailType({
      fromEmail: "alice@example.com",
      subject: "Can we meet Tuesday?",
      body: "Hey, are you free Tuesday afternoon to catch up?",
    })
    expect(result.emailType).toBe("needs_reply")
  })

  it("sender rule wins over body content for notification", () => {
    const result = classifyEmailType({
      fromEmail: "noreply@example.com",
      subject: "Question about your account",
      body: "Are you satisfied? unsubscribe here",
    })
    expect(result.emailType).toBe("notification")
  })

  it("classifies Azure notification as notification", () => {
    const result = classifyEmailType({
      fromEmail: "azure-noreply@microsoft.com",
      subject: "Azure DevOps build failed",
      body: "Build pipeline failed on main branch.",
    })
    expect(result.emailType).toBe("notification")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox && npx vitest run tests/email-classifier.test.ts 2>&1 | tail -20
```

Expected: FAIL — "Cannot find module '@/lib/agent/email-classifier'"

- [ ] **Step 3: Create `lib/agent/email-classifier.ts`**

```ts
export type EmailType = "needs_reply" | "notification" | "newsletter" | "marketing" | "fyi"

export type EmailClassifierInput = {
  fromEmail: string
  subject: string
  body: string
}

export type EmailClassifierResult = {
  emailType: EmailType
}

const NO_REPLY_LOCAL_PATTERN =
  /^(noreply|no-reply|donotreply|do-not-reply|do\.not\.reply|notifications?|mailer-daemon|bounce|alert|automated)$/i

const NOTIFICATION_DOMAINS = new Set([
  "github.com",
  "googleusercontent.com",
  "porkbun.com",
  "supabase.io",
  "supabase.com",
  "atlassian.net",
  "jira.com",
  "trello.com",
  "linear.app",
])

const GOOGLE_NOTIFICATION_DOMAIN_PATTERN = /^(docs|drive|accounts|no-reply)\.google\.com$/

const MICROSOFT_NOTIFICATION_DOMAIN_PATTERN = /^(azure|visualstudio|devops)\./i

const NOTIFICATION_SUBJECT_PATTERN =
  /(\[github\]|pr #\d|pull request|merged into|pushed to|invited you to|shared .{0,40} with you|azure devops|build (succeeded|failed)|deployment |your project on |supabase)/i

const NEWSLETTER_BODY_PATTERN =
  /\b(unsubscribe|manage preferences|email preferences|view in browser|view this email in your browser)\b/i

const MARKETING_SUBJECT_PATTERN =
  /\b(\d+%\s*off|discount|limited time|special offer|early access|free trial|upgrade now|deal of the day)\b/i

function extractDomain(email: string): string {
  const match = email.match(/@([^>\s]+)/)
  return match ? match[1].toLowerCase().replace(/^[^a-z0-9]+/, "") : ""
}

function extractLocalPart(email: string): string {
  const normalized = email.replace(/.*</, "").replace(/>.*/, "").trim()
  const match = normalized.match(/^([^@]+)@/)
  return match ? match[1].toLowerCase() : ""
}

export function classifyEmailType(input: EmailClassifierInput): EmailClassifierResult {
  const { subject, body } = input
  const domain = extractDomain(input.fromEmail)
  const localPart = extractLocalPart(input.fromEmail)

  // Rule 1: No-reply local part
  if (NO_REPLY_LOCAL_PATTERN.test(localPart)) {
    return { emailType: "notification" }
  }

  // Rule 2: Known notification domains
  if (
    NOTIFICATION_DOMAINS.has(domain) ||
    GOOGLE_NOTIFICATION_DOMAIN_PATTERN.test(domain) ||
    MICROSOFT_NOTIFICATION_DOMAIN_PATTERN.test(domain)
  ) {
    return { emailType: "notification" }
  }

  // Rule 3: Subject-based notification patterns
  if (NOTIFICATION_SUBJECT_PATTERN.test(subject)) {
    return { emailType: "notification" }
  }

  // Rule 4: Newsletter body patterns
  if (NEWSLETTER_BODY_PATTERN.test(body)) {
    return { emailType: "newsletter" }
  }

  // Rule 5: Marketing subject patterns
  if (MARKETING_SUBJECT_PATTERN.test(subject)) {
    return { emailType: "marketing" }
  }

  return { emailType: "needs_reply" }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox && npx vitest run tests/email-classifier.test.ts 2>&1 | tail -20
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/agent/email-classifier.ts tests/email-classifier.test.ts
git commit -m "feat: add deterministic email type classifier"
```

---

## Task 2: Add `fetchGmailSentSamples` to `lib/google.ts`

**Files:**
- Modify: `lib/google.ts` (add export at end of file, before the last closing brace)

- [ ] **Step 1: Add `fetchGmailSentSamples` after `deleteCalendarEvent`**

Add this export to the end of `lib/google.ts` (after line 541):

```ts
// Fetches recent sent messages from Gmail SENT label for reply-style training
export async function fetchGmailSentSamples(
  channelId: string,
  limit = 60
): Promise<Array<{ text: string; createdAt: Date }>> {
  const gmail = await getGmailClient(channelId)

  const listRes = await gmail.users.messages.list({
    userId: "me",
    labelIds: ["SENT"],
    maxResults: limit,
  })

  const messages = listRes.data.messages ?? []
  const samples: Array<{ text: string; createdAt: Date }> = []

  for (const msg of messages) {
    if (!msg.id) continue
    try {
      const res = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "full",
      })
      const text = extractBody(res.data.payload)
      const createdAt = new Date(parseInt(res.data.internalDate ?? "0"))
      if (text.trim()) {
        samples.push({ text, createdAt })
      }
    } catch {
      // Skip unfetchable messages silently
    }
  }

  return samples
}
```

- [ ] **Step 2: Run full test suite to confirm no regressions**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox && npm test 2>&1 | tail -10
```

Expected: All tests pass (same count as before).

- [ ] **Step 3: Commit**

```bash
git add lib/google.ts
git commit -m "feat: add fetchGmailSentSamples for reply-style training"
```

---

## Task 3: Update `lib/agent/reply-learning.ts` to fall back to Gmail SENT

**Files:**
- Modify: `lib/agent/reply-learning.ts`
- Create: `tests/reply-learning.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/reply-learning.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest"
import { sanitizeOutboundReply, collectOutboundReplySamples } from "@/lib/agent/reply-learning"

describe("sanitizeOutboundReply", () => {
  it("strips quoted thread content", () => {
    const result = sanitizeOutboundReply(
      "Thanks for reaching out!\n\nOn Mon, Jan 1 wrote:\n> Original message here"
    )
    expect(result).toBe("Thanks for reaching out!")
  })

  it("returns null for automated messages", () => {
    expect(sanitizeOutboundReply("This is an automated notification reply")).toBeNull()
    expect(sanitizeOutboundReply("Please do not reply to this email")).toBeNull()
  })

  it("returns null for very short messages", () => {
    expect(sanitizeOutboundReply("Ok")).toBeNull()
  })

  it("truncates very long messages", () => {
    const long = "a".repeat(2000)
    const result = sanitizeOutboundReply(long)
    expect(result).not.toBeNull()
    expect(result!.length).toBeLessThanOrEqual(1603) // 1600 + "..."
  })
})

// trainLearnedReplyProfile fallback is tested via integration in the route test
// The key behavior: if DB returns < 5, Gmail SENT is used
describe("sanitizeOutboundReply edge cases", () => {
  it("filters out lines starting with >", () => {
    const input = "My reply\n> Quoted text\n> More quoted"
    const result = sanitizeOutboundReply(input)
    expect(result).toBe("My reply")
  })

  it("returns null for unsubscribe content", () => {
    const result = sanitizeOutboundReply("Click here to unsubscribe from this list")
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify existing sanitize logic**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox && npx vitest run tests/reply-learning.test.ts 2>&1 | tail -20
```

Expected: All PASS (these test existing logic)

- [ ] **Step 3: Modify `lib/agent/reply-learning.ts` to fall back to Gmail SENT**

Replace the `trainLearnedReplyProfile` function (lines 77–142) with:

```ts
import { fetchGmailSentSamples } from "@/lib/google"

export async function trainLearnedReplyProfile(input: {
  tenantId: string
  channelId?: string | null
  profileType: ReplyProfileTypeValue
}): Promise<{ profileId: string; sampleCount: number; fromGmail: number; fromDb: number }> {
  const dbSamples = await collectOutboundReplySamples({
    tenantId: input.tenantId,
    channelId: input.channelId,
  })

  let gmailSamples: OutboundReplySample[] = []

  if (dbSamples.length < 5 && input.channelId) {
    const raw = await fetchGmailSentSamples(input.channelId, 60)
    gmailSamples = raw
      .map((s) => {
        const text = sanitizeOutboundReply(s.text)
        return text ? { text, createdAt: s.createdAt } : null
      })
      .filter((s): s is OutboundReplySample => s !== null)
  }

  // Merge, dedup by text content, Gmail supplements DB
  const seen = new Set(dbSamples.map((s) => s.text))
  const freshGmail = gmailSamples.filter((s) => !seen.has(s.text))
  const samples = [...dbSamples, ...freshGmail]

  if (samples.length < 5) {
    const triedGmail = input.channelId ? " FlowDesk also checked your Gmail sent history." : ""
    throw new Error(
      `Not enough sent emails to learn from.${triedGmail} At least 5 usable sent emails are required.`
    )
  }

  let result: Awaited<ReturnType<typeof summarizeLearnedReplyProfile>>
  try {
    result = await summarizeLearnedReplyProfile(samples)
    await recordAiUsageEvent({
      tenantId: input.tenantId,
      feature: "reply_learning.train",
      model: result.model,
      estimatedInputTokens: result.estimatedInputTokens,
      estimatedOutputTokens: result.estimatedOutputTokens,
      status: "completed",
    })
  } catch (err) {
    await recordAiUsageEvent({
      tenantId: input.tenantId,
      feature: "reply_learning.train",
      model: process.env.OPENAI_LEARNING_MODEL || process.env.OPENAI_MODEL || "unknown",
      status: "failed",
    })
    throw err
  }

  const data = {
    tenantId: input.tenantId,
    channelId: input.channelId ?? null,
    profileType: input.profileType,
    styleSummaryJson: result.styleSummaryJson as Prisma.InputJsonValue,
    exampleSnippetsJson: result.exampleSnippetsJson as Prisma.InputJsonValue,
    sourceStatsJson: {
      ...result.sourceStatsJson,
      sampleCount: samples.length,
      fromDb: dbSamples.length,
      fromGmail: freshGmail.length,
    } as Prisma.InputJsonValue,
    promptVersion: result.promptVersion,
    lastTrainedAt: new Date(),
  }

  const existing = await prisma.learnedReplyProfile.findFirst({
    where: {
      tenantId: input.tenantId,
      channelId: input.channelId ?? null,
      profileType: input.profileType,
    },
  })

  const profile = existing
    ? await prisma.learnedReplyProfile.update({ where: { id: existing.id }, data })
    : await prisma.learnedReplyProfile.create({ data })

  return {
    profileId: profile.id,
    sampleCount: samples.length,
    fromDb: dbSamples.length,
    fromGmail: freshGmail.length,
  }
}
```

Also update the return type of `trainLearnedReplyProfile` and the route that calls it (see Task 8).

- [ ] **Step 4: Run tests**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox && npm test 2>&1 | tail -10
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add lib/agent/reply-learning.ts lib/google.ts tests/reply-learning.test.ts
git commit -m "feat: reply-style learning falls back to Gmail sent history"
```

---

## Task 4: Update `app/settings/PersonalStylePanel.tsx` copy

**Files:**
- Modify: `app/settings/PersonalStylePanel.tsx`

- [ ] **Step 1: Update training label and sample count display**

Change the `training` button label (line ~152):
```tsx
{training ? "Learning from your recent sent emails..." : "Train Style"}
```

Change the sample count display (line ~79):
```tsx
<p className="text-sm font-medium">
  {initial.sampleCount != null ? initial.sampleCount : 0} emails analyzed
  {(initial as { fromGmail?: number }).fromGmail
    ? ` (${(initial as { fromGmail?: number }).fromGmail} from Gmail sent history)`
    : ""}
</p>
```

Note: `fromGmail` is stored in `sourceStatsJson` on the profile. The settings page would need to expose it. For now, the button copy change alone is the high-value fix.

- [ ] **Step 2: Run tests to confirm no regressions**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox && npm test 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add app/settings/PersonalStylePanel.tsx
git commit -m "ui: update reply-style training copy to reflect Gmail sent history"
```

---

## Task 5: Add `accountType` to classify prompt in `lib/ai/prompts/classify.ts`

**Files:**
- Modify: `lib/ai/prompts/classify.ts`

- [ ] **Step 1: Add `accountType` to `ClassifyPromptInput` and update `buildClassifyPrompt`**

Replace the type and function:

```ts
export type ClassifyPromptInput = {
  accountType?: "personal" | "business" | null
  businessProfile: {
    businessName?: string | null
    industry?: string | null
    timezone?: string | null
    defaultTone?: string | null
    bookingPolicy?: string | null
    escalationPolicy?: string | null
  } | null
  messages: Array<{
    direction: string
    body: string
    createdAt: Date | string
  }>
}

export function buildClassifyPrompt(input: ClassifyPromptInput): string {
  const isPersonal = input.accountType === "personal"
  const messages = input.messages
    .slice(-20)
    .map((m) => {
      const ts = m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt
      return `${ts} ${m.direction.toUpperCase()}: ${m.body.slice(0, 2000)}`
    })
    .join("\n")

  if (isPersonal) {
    return [
      "You are FlowDesk's email assistant for a personal inbox.",
      "Classify the email thread and return only JSON matching the schema.",
      "Do not generate a reply. Do not include markdown.",
      "",
      "Focus on:",
      "- Does this email need a personal reply from the user?",
      "- How urgent is it?",
      "- What action or task is required, if any?",
      "- Is this scheduling, follow-up, or informational?",
      "",
      "Always set suggestedLabel to null — personal inboxes do not use CRM labels.",
      "Set requiresApproval true if the email is sensitive (medical, legal, financial, personal conflict).",
      "",
      "Safety rules:",
      "- Do not reference leads, sales potential, CRM pipeline, prospects, or revenue.",
      "- When in doubt, set riskLevel to medium.",
      "",
      "Conversation:",
      messages || "No messages.",
    ].join("\n")
  }

  const profile = input.businessProfile
  return [
    "You are FlowDesk's AI classifier for a small business inbox.",
    "Classify the conversation intent and return only JSON matching the schema.",
    "Do not generate a reply. Do not include markdown.",
    "",
    "Allowed suggestedLabel values: Lead, Reschedule, Pricing, Complaint, or null.",
    "Set requiresApproval true if: riskLevel is high, confidence is below 0.5,",
    "or the topic involves medical advice, complaints, legal matters, or pricing negotiation.",
    "",
    "Safety rules:",
    "- Do not expose internal policies or other customer data.",
    "- When in doubt, set riskLevel to high and requiresApproval to true.",
    "",
    "Business profile:",
    JSON.stringify(
      {
        businessName: profile?.businessName ?? null,
        industry: profile?.industry ?? null,
        timezone: profile?.timezone ?? null,
        bookingPolicy: profile?.bookingPolicy ?? null,
        escalationPolicy: profile?.escalationPolicy ?? null,
      },
      null,
      2
    ),
    "",
    "Conversation:",
    messages || "No messages.",
  ].join("\n")
}
```

- [ ] **Step 2: Run all tests**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox && npm test 2>&1 | tail -10
```

Expected: All pass (callers that don't pass `accountType` default to business prompt via the `isPersonal` check).

- [ ] **Step 3: Commit**

```bash
git add lib/ai/prompts/classify.ts
git commit -m "feat: classify prompt is account-type aware; personal prompt omits sales/lead framing"
```

---

## Task 6: Pass `accountType` in `lib/agent/jobs.ts`

**Files:**
- Modify: `lib/agent/jobs.ts`

- [ ] **Step 1: Fetch `accountType` and pass to `classifyConversation`**

In `_executeJob`, add a tenant lookup and pass `accountType` to `classifyConversation`.

Replace the `_executeJob` function signature and the `[conversation, businessContext]` parallel fetch:

```ts
async function _executeJob(
  job: AgentJob
): Promise<{ intent: string; confidence: number; requiresApproval: boolean; classification: ClassifyResult; policyRequiresApproval: boolean }> {
  const [conversation, businessContext, tenant] = await Promise.all([
    prisma.conversation.findFirst({
      where: { id: job.conversationId, tenantId: job.tenantId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    }),
    getFullBusinessContext(job.tenantId),
    prisma.tenant.findUnique({
      where: { id: job.tenantId },
      select: { accountType: true },
    }),
  ])

  if (!conversation) {
    throw new Error("Conversation not found during job execution")
  }

  // ... rest of the function unchanged, except the classifyConversation call:
  classification = await classifyConversation({
    messages: conversation.messages,
    businessProfile: businessContext.profile,
    accountType: tenant?.accountType === "personal" ? "personal" : "business",
  })
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox && npm test 2>&1 | tail -10
```

Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add lib/agent/jobs.ts
git commit -m "feat: pass accountType to classify so personal accounts skip sales/lead prompt"
```

---

## Task 7: Add account-type guard and `emailType` to `lib/agent/work-item-sync.ts`

**Files:**
- Modify: `lib/agent/work-item-sync.ts`

- [ ] **Step 1: Add tenant lookup, account-type guard, and email type classification**

At the top of `syncConversationWorkItems`, after fetching the conversation, add:

```ts
import { classifyEmailType } from "@/lib/agent/email-classifier"
import { extractEmail } from "@/lib/google"

// Inside syncConversationWorkItems, after const conversation = ...
const tenant = await prisma.tenant.findUnique({
  where: { id: input.tenantId },
  select: { accountType: true },
})
const isPersonal = tenant?.accountType === "personal"
```

Then gate lead scoring and sales classification:

```ts
// Replace: void scoreLeadForConversation(...) 
if (!isPersonal) {
  void scoreLeadForConversation(conversation.tenantId, upsertedLead.id).catch(() => {})
}
```

And gate sales classification:

```ts
// Replace the salesSignals block
let salesClassified = false
if (!isPersonal) {
  const salesSignals = classifySalesSignals(
    conversation.messages.map((m) => ({ direction: m.direction, body: m.body }))
  )
  // ... existing sales upsert logic ...
  salesClassified = salesSignals.isSalesLead
}
```

And after support classification, add email type:

```ts
// After the support classification block, before the return statement:
const firstInbound = conversation.messages.find((m) => m.direction === "inbound")
if (firstInbound) {
  const fromEmail = extractEmail(firstInbound.fromE164 ?? "")
  const { emailType } = classifyEmailType({
    fromEmail,
    subject: "",
    body: firstInbound.body,
  })

  if (emailType !== "needs_reply") {
    const currentMeta = (await prisma.conversationState.findUnique({
      where: { conversationId: conversation.id },
      select: { metadataJson: true },
    }))?.metadataJson

    const metaBase =
      currentMeta && typeof currentMeta === "object" && !Array.isArray(currentMeta)
        ? (currentMeta as Record<string, unknown>)
        : {}

    await prisma.conversationState.update({
      where: { conversationId: conversation.id },
      data: { metadataJson: { ...metaBase, emailType } as Prisma.InputJsonValue },
    })
  }
}
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox && npm test 2>&1 | tail -10
```

Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add lib/agent/work-item-sync.ts
git commit -m "feat: skip lead/sales scoring for personal accounts; store emailType in metadata"
```

---

## Task 8: Update `lib/agent/command-center.ts` to honor `emailType`

**Files:**
- Modify: `lib/agent/command-center.ts`
- Modify: `tests/command-center.test.ts`

- [ ] **Step 1: Add failing tests for emailType override**

Add to `tests/command-center.test.ts`:

```ts
describe("emailType overrides", () => {
  it("classifies notification emailType as fyi_only", () => {
    const result = analyzeConversationForCommandCenter(
      conversation({
        status: "needs_reply",
        conversationState: { metadataJson: { emailType: "notification" } },
      }),
      now
    )
    expect(result.state).toBe("fyi_only")
    expect(result.priority).toBe("none")
    expect(result.reason).toContain("Automated notification")
    expect(result.safelyIgnored).toBe(true)
  })

  it("classifies newsletter emailType as fyi_only", () => {
    const result = analyzeConversationForCommandCenter(
      conversation({
        status: "needs_reply",
        conversationState: { metadataJson: { emailType: "newsletter" } },
      }),
      now
    )
    expect(result.state).toBe("fyi_only")
    expect(result.reason).toContain("Newsletter")
    expect(result.safelyIgnored).toBe(true)
  })

  it("classifies marketing emailType as fyi_only", () => {
    const result = analyzeConversationForCommandCenter(
      conversation({
        status: "needs_reply",
        conversationState: { metadataJson: { emailType: "marketing" } },
      }),
      now
    )
    expect(result.state).toBe("fyi_only")
    expect(result.safelyIgnored).toBe(true)
  })

  it("sensitive notification still gets flagged as sensitive", () => {
    const result = analyzeConversationForCommandCenter(
      conversation({
        status: "needs_reply",
        label: "Complaint",
        conversationState: { metadataJson: { emailType: "notification" } },
        messages: [{ direction: "inbound", body: "Legal dispute about refund", createdAt: now }],
      }),
      now
    )
    // Sensitive wins over notification
    expect(result.state).toBe("risky_urgent")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox && npx vitest run tests/command-center.test.ts 2>&1 | tail -20
```

Expected: The 3 new emailType tests FAIL.

- [ ] **Step 3: Add `getEmailType` helper and update `analyzeConversationForCommandCenter`**

Add after the existing pattern constants in `lib/agent/command-center.ts`:

```ts
type AutoEmailType = "notification" | "newsletter" | "marketing"
const AUTO_EMAIL_TYPES = new Set<string>(["notification", "newsletter", "marketing"])

function getEmailType(conversation: CommandCenterInputConversation): string | null {
  const state = conversation.conversationState
  if (!state?.metadataJson || typeof state.metadataJson !== "object" || Array.isArray(state.metadataJson)) return null
  const v = (state.metadataJson as Record<string, unknown>).emailType
  return typeof v === "string" ? v : null
}

function isAutoEmail(conversation: CommandCenterInputConversation): boolean {
  return AUTO_EMAIL_TYPES.has(getEmailType(conversation) ?? "")
}
```

In `analyzeConversationForCommandCenter`, add the auto-email check **after** the `sensitive` check (sensitive always wins) and **before** the `churnRisk` check:

```ts
const autoEmail = isAutoEmail(conversation)

// In the state assignment chain, add after the sensitive block:
} else if (autoEmail) {
  const emailType = getEmailType(conversation) as AutoEmailType
  const reasons: Record<AutoEmailType, string> = {
    notification: "Automated notification — no reply needed.",
    newsletter: "Newsletter or marketing email.",
    marketing: "Marketing / promotional email.",
  }
  const actions: Record<AutoEmailType, string> = {
    notification: "Review only if relevant.",
    newsletter: "Unsubscribe if not relevant.",
    marketing: "No action needed.",
  }
  state = "fyi_only"
  priority = "none"
  reason = reasons[emailType]
  nextAction = actions[emailType]
```

Also update `isSafelyIgnorable` to return `true` for auto emails:

```ts
function isSafelyIgnorable(conversation: CommandCenterInputConversation): boolean {
  if (isAutoEmail(conversation)) return true
  const latest = latestMessage(conversation)
  return (
    conversation.status === "closed" ||
    (conversation.status !== "needs_reply" &&
      !hasPendingApproval(conversation) &&
      !isSensitive(conversation) &&
      latest?.direction === "inbound" &&
      FYI_PATTERN.test(latest.body))
  )
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox && npx vitest run tests/command-center.test.ts 2>&1 | tail -20
```

Expected: All pass including new emailType tests.

- [ ] **Step 5: Run full test suite**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox && npm test 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
git add lib/agent/command-center.ts tests/command-center.test.ts
git commit -m "feat: command center overrides needs_reply for notification/newsletter/marketing emails"
```

---

## Task 9: Pass `conversationState` into `assistantInput` in conversation page

**Files:**
- Modify: `app/conversations/[id]/page.tsx`

- [ ] **Step 1: Add `conversationState` to `assistantInput` and suppress Handle This for auto emails**

In the `assistantInput` object (around line 195):

```ts
const assistantInput = {
  id: conversation.id,
  externalThreadId: conversation.externalThreadId,
  label: conversation.label,
  status: conversation.status,
  lastMessageAt: conversation.lastMessageAt,
  contact: conversation.contact,
  channel: conversation.channel,
  messages: conversation.messages,
  draft: conversation.draft,
  agentJobs: latestAgentJob ? [latestAgentJob] : [],
  approvalRequests: pendingApprovals,
  calendarHolds: activeHold ? [activeHold] : [],
  conversationState: stateRecord ?? null,  // ADD THIS LINE
};
```

Then read `emailType` from `convMeta` (already parsed):

```ts
const emailType =
  typeof convMeta.emailType === "string" ? convMeta.emailType : null
const isAutoEmail = emailType === "notification" || emailType === "newsletter" || emailType === "marketing"
```

Then update the `HandleThisPanel` render:

```tsx
{isAutoEmail ? (
  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <h2 className="text-sm font-semibold text-slate-600">Assistant context</h2>
    <p className="mt-1 text-xs text-slate-500">{assistantState.reason}</p>
    <p className="mt-3 text-xs text-slate-400 italic">No reply needed for this email.</p>
  </div>
) : (
  <HandleThisPanel
    conversationId={conversation.id}
    assistantState={assistantState}
    relationshipContext={relationshipContext}
    canSuggest={conversation.channel.type === "email" && Boolean(businessProfile)}
  />
)}
```

- [ ] **Step 2: Run full test suite**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox && npm test 2>&1 | tail -10
```

Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add app/conversations/[id]/page.tsx
git commit -m "feat: suppress Handle This for automated notifications and newsletters"
```

---

## Task 10: Update `tests/agent-job-pipeline.test.ts` for personal account prompt

**Files:**
- Modify: `tests/agent-job-pipeline.test.ts`

- [ ] **Step 1: Verify personal account classify prompt omits sales language**

Add at the end of `tests/agent-job-pipeline.test.ts`:

```ts
describe("classify prompt for personal accounts", () => {
  it("personal account prompt does not mention sales or leads", () => {
    const { buildClassifyPrompt } = require("@/lib/ai/prompts/classify")
    const prompt = buildClassifyPrompt({
      accountType: "personal",
      businessProfile: null,
      messages: [{ direction: "inbound", body: "Hey can we meet?", createdAt: new Date() }],
    })
    expect(prompt).not.toMatch(/lead/i)
    expect(prompt).not.toMatch(/sales potential/i)
    expect(prompt).not.toMatch(/business owner/i)
    expect(prompt).not.toMatch(/CRM/i)
    expect(prompt).toMatch(/personal inbox/i)
  })

  it("business account prompt includes business framing", () => {
    const { buildClassifyPrompt } = require("@/lib/ai/prompts/classify")
    const prompt = buildClassifyPrompt({
      accountType: "business",
      businessProfile: null,
      messages: [{ direction: "inbound", body: "I want pricing info", createdAt: new Date() }],
    })
    expect(prompt).toMatch(/small business inbox/i)
    expect(prompt).toMatch(/Lead/i)
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox && npm test 2>&1 | tail -10
```

Expected: All pass.

- [ ] **Step 3: Final commit**

```bash
git add tests/agent-job-pipeline.test.ts
git commit -m "test: verify personal account classify prompt omits sales/lead framing"
```

---

## Final Verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Update `docs/CURRENT_STATE.md` with the shipped changes
- [ ] Update `docs/MASTER_PRODUCT_PLAN.md` feature index if status changed
