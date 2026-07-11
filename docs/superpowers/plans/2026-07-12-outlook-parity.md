# Outlook Feature Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Outlook channels to full feature parity with Gmail — auto-labeling (via Outlook categories), bulk archive/unsubscribe, trash, read-state writeback, AI drafts in the Drafts folder, feedback learning, reconcile crons, operator health, onboarding — through a shared writeback layer instead of a duplicated stack.

**Architecture:** One provider-neutral writeback queue (`EmailWritebackQueue`, renamed from `GmailWritebackQueue`) drained by one generalized processor that dispatches per-channel-provider through a small `EmailWritebackAdapter` (`lib/email/writeback-adapter.ts`). Gmail's adapter wraps existing `lib/google.ts` functions unchanged; Outlook's adapter is a new `lib/outlook-mailbox.ts` built on `lib/microsoft.ts` Graph helpers. Projection, clean-inbox, reconcile crons, and conversation action routes stop hard-coding `provider === "google"` and use the adapter. Sync stays per-provider (Gmail history / Outlook delta), with a small delta extension (`categories`, `isRead`) to power feedback learning and read-state parity.

**Tech Stack:** Next.js App Router, Prisma + Postgres, Vitest, raw `fetch` Graph client (no SDK). Spec: `docs/superpowers/specs/2026-07-12-outlook-parity-design.md`.

## Global Constraints

- All work happens in the worktree `.worktrees/feat-outlook-parity` on branch `feat/outlook-parity`. Never commit to main.
- Run commands from the worktree root: `cd "/Users/shivansh/Downloads/Coding Stuff/VSC Files/FlowDesk Inbox/.worktrees/feat-outlook-parity"`. Run `npm install && npx prisma generate` there once before the first task (repo gotcha: stale client shows phantom `tsc` errors in `lib/outlook-*.ts`).
- Test runner is Vitest: `npx vitest run <file>` (never Jest). Full gate before PR: `npm test`, `npx tsc --noEmit`, `npm run lint`.
- Conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`).
- Label taxonomy canonical names never change here: `Needs Reply, Needs Action, Waiting On, Read Later, Handled, Autodrafted, Newsletter, Marketing, Notification, Calendar`.
- Automation-level keys stay `apply_gmail_labels` (level ≥2) and `create_gmail_drafts` (level ≥3) for BOTH providers — they mean "in the user's mailbox"; only copy/comments change.
- Audit action names: Gmail keeps `gmail.*` exactly as today; Outlook uses the same shapes under `outlook.*` (`outlook.writeback.completed|failed`, `outlook.labels.queued|corrected`, `outlook.draft.queued|withdraw_queued`).
- Existing Gmail behavior must not change: every currently-green test stays green (mechanical renames aside).
- Tests mock `prisma` and provider modules inline per file, following the existing patterns in `tests/outlook-*.test.ts` / `tests/gmail-writeback-labels.test.ts`. No new mock frameworks.

---

### Task 1: Rename `GmailWritebackQueue` → `EmailWritebackQueue`

Purely mechanical rename — no behavior change. Locks in the neutral queue every later task builds on.

**Files:**
- Modify: `prisma/schema.prisma` (model at lines 205–224; relations at 104, 164, 375)
- Create: `prisma/migrations/20260712000000_rename_gmail_writeback_queue/migration.sql`
- Modify (call sites `prisma.gmailWritebackQueue` → `prisma.emailWritebackQueue`, relation names, type imports): `lib/agent/gmail-writeback-processor.ts`, `lib/gmail-labels.ts`, `lib/gmail-drafts.ts`, `lib/google.ts` (mark-read fallback upsert), `lib/agent/gmail-state-reconcile.ts`, `lib/agent/gmail-label-feedback.ts`, `app/settings/connect/page.tsx` (health input counts), plus any other hit from `rg -l 'gmailWritebackQueue|GmailWritebackQueue' --type ts`
- Modify: every test file matching `rg -l 'gmailWritebackQueue|GmailWritebackQueue' tests/`

**Interfaces:**
- Produces: Prisma model `EmailWritebackQueue` (same columns/indexes), client accessor `prisma.emailWritebackQueue`, relations `Channel.emailWritebackQueue`, `Conversation.emailWritebacks`, `Tenant.emailWritebackQueue`.

- [ ] **Step 1: Edit `prisma/schema.prisma`**

Rename the model and relation fields (columns untouched):

```prisma
model EmailWritebackQueue {
  id                     String   @id @default(cuid())
  tenantId               String
  channelId              String
  conversationId         String
  action                 String
  providerMessageIdsJson Json
  attempts               Int      @default(0)
  lastError              String?
  status                 String   @default("pending")
  nextAttemptAt          DateTime @default(now())
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt
  tenant                 Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  channel                Channel  @relation(fields: [channelId], references: [id], onDelete: Cascade)
  conversation           Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@unique([conversationId, action])
  @@index([tenantId, status, nextAttemptAt])
}
```

Update the three relation declarations: `Tenant.gmailWritebackQueue` → `emailWritebackQueue EmailWritebackQueue[]` (schema line ~104), `Channel.gmailWritebackQueue` → `emailWritebackQueue EmailWritebackQueue[]` (line ~164), `Conversation.gmailWritebacks` → `emailWritebacks EmailWritebackQueue[]` (line ~375). Update the model doc comment: the queue now holds mailbox writebacks for **all email providers** (Gmail + Outlook), rows provider-scoped via `channelId`.

- [ ] **Step 2: Write the hand-crafted rename migration**

`prisma/migrations/20260712000000_rename_gmail_writeback_queue/migration.sql` — a RENAME, not drop+create, so in-flight rows survive:

```sql
ALTER TABLE "GmailWritebackQueue" RENAME TO "EmailWritebackQueue";
ALTER INDEX "GmailWritebackQueue_pkey" RENAME TO "EmailWritebackQueue_pkey";
ALTER INDEX "GmailWritebackQueue_conversationId_action_key" RENAME TO "EmailWritebackQueue_conversationId_action_key";
ALTER INDEX "GmailWritebackQueue_tenantId_status_nextAttemptAt_idx" RENAME TO "EmailWritebackQueue_tenantId_status_nextAttemptAt_idx";
ALTER TABLE "EmailWritebackQueue" RENAME CONSTRAINT "GmailWritebackQueue_tenantId_fkey" TO "EmailWritebackQueue_tenantId_fkey";
ALTER TABLE "EmailWritebackQueue" RENAME CONSTRAINT "GmailWritebackQueue_channelId_fkey" TO "EmailWritebackQueue_channelId_fkey";
ALTER TABLE "EmailWritebackQueue" RENAME CONSTRAINT "GmailWritebackQueue_conversationId_fkey" TO "EmailWritebackQueue_conversationId_fkey";
```

Verify actual index/constraint names first against an older migration that created the table (`rg -n 'GmailWritebackQueue' prisma/migrations/ | head`) and match them exactly. Then confirm schema/migration agreement: `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$DATABASE_URL_SHADOW"` should report no drift (or, if no shadow DB is configured locally, run `npx prisma validate` and rely on `prisma generate` + tests).

- [ ] **Step 3: Regenerate client and mechanically rename call sites**

Run: `npx prisma generate`
Then in every file from `rg -l 'gmailWritebackQueue|GmailWritebackQueue' --type ts .` replace `prisma.gmailWritebackQueue` → `prisma.emailWritebackQueue`, `gmailWritebacks` (relation include/select) → `emailWritebacks`, `gmailWritebackQueue` (relation include/select) → `emailWritebackQueue`, and Prisma type imports `GmailWritebackQueue` → `EmailWritebackQueue`. Do NOT rename local variables/audit strings containing `gmail.writeback` — those stay.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → 0 errors. Run: `npm test` → all pass (tests mocking `prisma.gmailWritebackQueue` were updated in Step 3).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor: rename GmailWritebackQueue to EmailWritebackQueue"
```

---

### Task 2: Provider-support helper + neutral taxonomy exports

Tiny dependency-free module the rest of the plan gates on, plus neutral names for the label taxonomy.

**Files:**
- Create: `lib/email/provider-support.ts`
- Modify: `lib/gmail-labels.ts` (add neutral aliases)
- Test: `tests/email-provider-support.test.ts`

**Interfaces:**
- Produces:
  - `MAILBOX_WRITEBACK_PROVIDERS: ReadonlySet<string>` = `{"google", "microsoft"}`
  - `supportsMailboxWriteback(provider: string | null | undefined): boolean`
  - `auditPrefixForProvider(provider: string): "gmail" | "outlook"` (throws on unsupported)
  - From `lib/gmail-labels.ts`: `FLOWDESK_LABEL_NAMES` (=== `FLOWDESK_GMAIL_LABEL_NAMES`), `type FlowDeskLabelName` (=== `FlowDeskGmailLabelName`), `isFlowDeskLabelName` (=== `isFlowDeskGmailLabelName`). Legacy names stay exported; only files already being modified switch to the neutral names.

- [ ] **Step 1: Write the failing test** (`tests/email-provider-support.test.ts`)

```ts
import { describe, expect, it } from "vitest"
import {
  MAILBOX_WRITEBACK_PROVIDERS,
  auditPrefixForProvider,
  supportsMailboxWriteback,
} from "@/lib/email/provider-support"

describe("provider support", () => {
  it("supports google and microsoft, rejects others", () => {
    expect(supportsMailboxWriteback("google")).toBe(true)
    expect(supportsMailboxWriteback("microsoft")).toBe(true)
    expect(supportsMailboxWriteback("twilio")).toBe(false)
    expect(supportsMailboxWriteback(null)).toBe(false)
    expect(supportsMailboxWriteback(undefined)).toBe(false)
    expect([...MAILBOX_WRITEBACK_PROVIDERS].sort()).toEqual(["google", "microsoft"])
  })
  it("maps providers to audit prefixes", () => {
    expect(auditPrefixForProvider("google")).toBe("gmail")
    expect(auditPrefixForProvider("microsoft")).toBe("outlook")
    expect(() => auditPrefixForProvider("twilio")).toThrow()
  })
})
```

Run: `npx vitest run tests/email-provider-support.test.ts` → FAIL (module not found).

- [ ] **Step 2: Implement `lib/email/provider-support.ts`**

```ts
// Which Channel.provider values FlowDesk can write back into (labels/archive/
// read-state/drafts land in the user's own mailbox). Deliberately free of
// heavy imports: consumed by hot paths (label projection) that must not pull
// googleapis or the Graph client into their static import graph.
export const MAILBOX_WRITEBACK_PROVIDERS: ReadonlySet<string> = new Set(["google", "microsoft"])

export function supportsMailboxWriteback(provider: string | null | undefined): boolean {
  return !!provider && MAILBOX_WRITEBACK_PROVIDERS.has(provider)
}

// Audit trail namespace per provider — gmail.* names predate Outlook parity
// and must stay stable for existing dashboards/history.
export function auditPrefixForProvider(provider: string): "gmail" | "outlook" {
  if (provider === "google") return "gmail"
  if (provider === "microsoft") return "outlook"
  throw new Error(`No mailbox writeback support for provider: ${provider}`)
}
```

- [ ] **Step 3: Add neutral aliases in `lib/gmail-labels.ts`** (right after the existing exports they alias)

```ts
// Neutral aliases: the taxonomy applies to any mailbox provider (Gmail labels,
// Outlook categories). New code should use these; the Gmail-suffixed names
// remain for existing imports.
export const FLOWDESK_LABEL_NAMES = FLOWDESK_GMAIL_LABEL_NAMES
export type FlowDeskLabelName = FlowDeskGmailLabelName
export const isFlowDeskLabelName = isFlowDeskGmailLabelName
```

- [ ] **Step 4: Run** `npx vitest run tests/email-provider-support.test.ts` → PASS, `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: mailbox writeback provider-support helper and neutral taxonomy aliases"`

---

### Task 3: `lib/outlook-mailbox.ts` — Graph mailbox operations

The Outlook counterpart of `lib/google.ts`'s label/archive/draft section. Pure provider module; no queue knowledge.

**Files:**
- Create: `lib/outlook-mailbox.ts`
- Test: `tests/outlook-mailbox.test.ts`

**Interfaces:**
- Consumes: `getOutlookAccessToken`, `graphGet`, `graphRequest`, `MicrosoftGraphError` from `@/lib/microsoft`; `FLOWDESK_LABEL_NAMES`, `isFlowDeskLabelName`, `type FlowDeskLabelName` from `@/lib/gmail-labels`.
- Produces (exact exports later tasks call):
  - `ensureFlowDeskCategories(channelId: string): Promise<void>`
  - `applyFlowDeskCategoriesToConversation(channelId: string, externalThreadId: string, labels: FlowDeskLabelName[]): Promise<void>`
  - `markOutlookConversationRead(channelId: string, providerMessageIds: string[]): Promise<void>`
  - `archiveOutlookConversation(channelId: string, externalThreadId: string): Promise<void>`
  - `restoreOutlookConversation(channelId: string, externalThreadId: string): Promise<void>`
  - `trashOutlookConversation(channelId: string, externalThreadId: string): Promise<void>`
  - `createOutlookDraftReply(channelId: string, input: { externalThreadId: string; body: string }): Promise<string>` (returns Graph draft message id)
  - `deleteOutlookDraft(channelId: string, draftId: string): Promise<void>` (404 = already gone, swallow)
  - `OUTLOOK_CONVERSATION_MESSAGE_CAP = 20`

- [ ] **Step 1: Write failing tests** (`tests/outlook-mailbox.test.ts`)

Mock `@/lib/microsoft` with `vi.mock` (as `tests/outlook-subscriptions.test.ts` does). Representative cases — implement all of these:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"

const graphGet = vi.fn()
const graphRequest = vi.fn()
vi.mock("@/lib/microsoft", () => ({
  getOutlookAccessToken: vi.fn().mockResolvedValue("token"),
  graphGet: (...args: unknown[]) => graphGet(...args),
  graphRequest: (...args: unknown[]) => graphRequest(...args),
  MicrosoftGraphError: class MicrosoftGraphError extends Error {
    constructor(public readonly status: number, public readonly code?: string) { super(`graph ${status}`) }
  },
}))

import {
  applyFlowDeskCategoriesToConversation,
  archiveOutlookConversation,
  createOutlookDraftReply,
  deleteOutlookDraft,
  ensureFlowDeskCategories,
  markOutlookConversationRead,
} from "@/lib/outlook-mailbox"

beforeEach(() => { graphGet.mockReset(); graphRequest.mockReset() })

describe("ensureFlowDeskCategories", () => {
  it("creates only missing categories with preset colors", async () => {
    graphGet.mockResolvedValueOnce({ value: [{ id: "1", displayName: "Needs Reply", color: "preset0" }] })
    graphRequest.mockResolvedValue({})
    await ensureFlowDeskCategories("ch1")
    const created = graphRequest.mock.calls.map(([, , opts]) => (opts as { body: { displayName: string } }).body.displayName)
    expect(created).toHaveLength(9) // 10 canonical minus the 1 existing
    expect(created).not.toContain("Needs Reply")
  })
  it("ignores 409 conflicts from concurrent creation", async () => {
    graphGet.mockResolvedValueOnce({ value: [] })
    const { MicrosoftGraphError } = await import("@/lib/microsoft")
    graphRequest.mockRejectedValue(new (MicrosoftGraphError as never)(409))
    await expect(ensureFlowDeskCategories("ch1")).resolves.toBeUndefined()
  })
})

describe("applyFlowDeskCategoriesToConversation", () => {
  it("patches each message, replacing FlowDesk categories but preserving user categories", async () => {
    graphGet
      .mockResolvedValueOnce({ value: [] }) // ensure: master categories
      .mockResolvedValueOnce({ value: [
        { id: "m1", categories: ["Handled", "My Custom"] },
        { id: "m2", categories: [] },
      ] })
    graphRequest.mockResolvedValue({})
    await applyFlowDeskCategoriesToConversation("ch1", "conv-abc", ["Needs Reply"])
    const patches = graphRequest.mock.calls.filter(([path]) => String(path).includes("/messages/"))
    expect(patches).toHaveLength(2)
    const m1 = patches.find(([path]) => String(path).includes("m1"))![2] as { body: { categories: string[] } }
    expect(m1.body.categories.sort()).toEqual(["My Custom", "Needs Reply"])
  })
  it("empty label set strips FlowDesk categories only", async () => {
    graphGet
      .mockResolvedValueOnce({ value: [] })
      .mockResolvedValueOnce({ value: [{ id: "m1", categories: ["Handled", "Keep Me"] }] })
    graphRequest.mockResolvedValue({})
    await applyFlowDeskCategoriesToConversation("ch1", "conv-abc", [])
    const [, , opts] = graphRequest.mock.calls.find(([path]) => String(path).includes("m1"))!
    expect((opts as { body: { categories: string[] } }).body.categories).toEqual(["Keep Me"])
  })
  it("skips PATCH when a message already has exactly the desired categories", async () => {
    graphGet
      .mockResolvedValueOnce({ value: [] })
      .mockResolvedValueOnce({ value: [{ id: "m1", categories: ["Needs Reply"] }] })
    await applyFlowDeskCategoriesToConversation("ch1", "conv-abc", ["Needs Reply"])
    expect(graphRequest.mock.calls.filter(([p]) => String(p).includes("/messages/"))).toHaveLength(0)
  })
})

describe("mark read / archive / drafts", () => {
  it("markOutlookConversationRead strips outlook_ prefix and PATCHes isRead", async () => {
    graphRequest.mockResolvedValue({})
    await markOutlookConversationRead("ch1", ["outlook_abc", "outlook_def"])
    expect(graphRequest).toHaveBeenCalledWith("/me/messages/abc", "token",
      expect.objectContaining({ method: "PATCH", body: { isRead: true } }))
  })
  it("archiveOutlookConversation moves each inbox message to the archive folder", async () => {
    graphGet.mockResolvedValueOnce({ value: [{ id: "m1" }, { id: "m2" }] })
    graphRequest.mockResolvedValue({ id: "moved" })
    await archiveOutlookConversation("ch1", "conv-abc")
    expect(graphRequest).toHaveBeenCalledWith("/me/messages/m1/move", "token",
      expect.objectContaining({ method: "POST", body: { destinationId: "archive" } }))
  })
  it("createOutlookDraftReply creates a reply draft then patches the body", async () => {
    graphGet.mockResolvedValueOnce({ value: [{ id: "last1" }] })
    graphRequest
      .mockResolvedValueOnce({ id: "draft1" }) // createReply
      .mockResolvedValueOnce({})               // body PATCH
    const id = await createOutlookDraftReply("ch1", { externalThreadId: "conv-abc", body: "hello" })
    expect(id).toBe("draft1")
    expect(graphRequest).toHaveBeenNthCalledWith(1, "/me/messages/last1/createReply", "token",
      expect.objectContaining({ method: "POST" }))
  })
  it("deleteOutlookDraft swallows 404", async () => {
    const { MicrosoftGraphError } = await import("@/lib/microsoft")
    graphRequest.mockRejectedValueOnce(new (MicrosoftGraphError as never)(404))
    await expect(deleteOutlookDraft("ch1", "gone")).resolves.toBeUndefined()
  })
})
```

Run: `npx vitest run tests/outlook-mailbox.test.ts` → FAIL (module not found).

- [ ] **Step 2: Implement `lib/outlook-mailbox.ts`**

```ts
import {
  getOutlookAccessToken,
  graphGet,
  graphRequest,
  MicrosoftGraphError,
} from "@/lib/microsoft"
import {
  FLOWDESK_LABEL_NAMES,
  isFlowDeskLabelName,
  type FlowDeskLabelName,
} from "@/lib/gmail-labels"

// Outlook has no thread-level mutation API: every operation fans out over the
// conversation's messages. Cap the fan-out so a 500-message newsletter thread
// can't turn one writeback job into 500 Graph calls.
export const OUTLOOK_CONVERSATION_MESSAGE_CAP = 20

// Graph master categories only take preset colors (preset0–preset24), not hex.
// Nearest-preset mapping of FLOWDESK_GMAIL_LABEL_COLORS in lib/google.ts.
const FLOWDESK_CATEGORY_PRESETS: Record<FlowDeskLabelName, string> = {
  "Needs Reply": "preset0",   // red (Gmail coral)
  "Needs Action": "preset1",  // orange
  "Waiting On": "preset7",    // blue
  "Read Later": "preset9",    // cranberry (Gmail rose)
  Handled: "preset12",        // gray
  Autodrafted: "preset8",     // purple
  Newsletter: "preset3",      // yellow
  Marketing: "preset15",      // dark red
  Notification: "preset5",    // teal (Gmail cyan)
  Calendar: "preset4",        // green
}

const FLOWDESK_CATEGORY_SET = new Set<string>(FLOWDESK_LABEL_NAMES)

type MasterCategory = { id: string; displayName: string; color?: string }
type ConversationMessage = { id: string; categories?: string[] }

function graphIdFromProviderMessageId(providerMessageId: string): string | null {
  return providerMessageId.startsWith("outlook_") ? providerMessageId.slice("outlook_".length) : null
}

async function listConversationMessages(
  token: string,
  externalThreadId: string,
  extra: { draftsOnly?: boolean } = {}
): Promise<ConversationMessage[]> {
  const params = new URLSearchParams({
    $filter: `conversationId eq '${externalThreadId.replace(/'/g, "''")}' and isDraft eq ${extra.draftsOnly ? "true" : "false"}`,
    $orderby: "receivedDateTime desc",
    $top: String(OUTLOOK_CONVERSATION_MESSAGE_CAP),
    $select: "id,categories",
  })
  const page = await graphGet<{ value: ConversationMessage[] }>(`/messages?${params}`, token)
  return page.value ?? []
}

// Adopts existing same-named categories (never duplicates, never deletes user
// categories); creates missing ones with the nearest preset color. A 409 from
// a concurrent create is success — the category exists.
export async function ensureFlowDeskCategories(channelId: string): Promise<void> {
  const token = await getOutlookAccessToken(channelId)
  const existing = await graphGet<{ value: MasterCategory[] }>("/outlook/masterCategories", token)
  const have = new Set((existing.value ?? []).map((category) => category.displayName))
  for (const name of FLOWDESK_LABEL_NAMES) {
    if (have.has(name)) continue
    try {
      await graphRequest("/me/outlook/masterCategories", token, {
        method: "POST",
        body: { displayName: name, color: FLOWDESK_CATEGORY_PRESETS[name] },
      })
    } catch (err) {
      if (err instanceof MicrosoftGraphError && err.status === 409) continue
      throw err
    }
  }
}

// The Outlook analog of applyFlowDeskLabelsToGmailThread: desired FlowDesk
// categories replace the current FlowDesk set on each message; the user's own
// categories are always preserved. An empty `labels` array means "remove all
// FlowDesk categories". 404 on a single message (user moved/deleted it) is
// skipped, not fatal.
export async function applyFlowDeskCategoriesToConversation(
  channelId: string,
  externalThreadId: string,
  labels: FlowDeskLabelName[]
): Promise<void> {
  const desired = Array.from(new Set(labels.filter(isFlowDeskLabelName)))
  await ensureFlowDeskCategories(channelId)
  const token = await getOutlookAccessToken(channelId)
  const messages = await listConversationMessages(token, externalThreadId)

  for (const message of messages) {
    const current = message.categories ?? []
    const next = [
      ...current.filter((category) => !FLOWDESK_CATEGORY_SET.has(category)),
      ...desired,
    ]
    const unchanged =
      next.length === current.length && next.every((category) => current.includes(category))
    if (unchanged) continue
    try {
      await graphRequest(`/me/messages/${message.id}`, token, {
        method: "PATCH",
        body: { categories: next },
      })
    } catch (err) {
      if (err instanceof MicrosoftGraphError && err.status === 404) continue
      throw err
    }
  }
}

export async function markOutlookConversationRead(
  channelId: string,
  providerMessageIds: string[]
): Promise<void> {
  const token = await getOutlookAccessToken(channelId)
  for (const providerMessageId of providerMessageIds) {
    const id = graphIdFromProviderMessageId(providerMessageId)
    if (!id) continue
    try {
      await graphRequest(`/me/messages/${id}`, token, { method: "PATCH", body: { isRead: true } })
    } catch (err) {
      if (err instanceof MicrosoftGraphError && err.status === 404) continue
      throw err
    }
  }
}

// Moving a message out of the inbox surfaces as @removed in the inbox-scoped
// delta feed, so the local Message rows disappear on the next sync — the
// conversation is already closed locally by every archive caller, matching
// the "leaves the inbox" contract. Restore looks the messages up by
// conversationId in the target folder (message ids change on move, so we
// never try to remember them).
async function moveConversationMessages(
  channelId: string,
  externalThreadId: string,
  fromFolder: "inbox" | "archive",
  destinationId: string
): Promise<void> {
  const token = await getOutlookAccessToken(channelId)
  const params = new URLSearchParams({
    $filter: `conversationId eq '${externalThreadId.replace(/'/g, "''")}'`,
    $top: String(OUTLOOK_CONVERSATION_MESSAGE_CAP),
    $select: "id",
  })
  const page = await graphGet<{ value: Array<{ id: string }> }>(
    `/mailFolders('${fromFolder}')/messages?${params}`,
    token
  )
  for (const message of page.value ?? []) {
    try {
      await graphRequest(`/me/messages/${message.id}/move`, token, {
        method: "POST",
        body: { destinationId },
      })
    } catch (err) {
      if (err instanceof MicrosoftGraphError && err.status === 404) continue
      throw err
    }
  }
}

export async function archiveOutlookConversation(channelId: string, externalThreadId: string): Promise<void> {
  await moveConversationMessages(channelId, externalThreadId, "inbox", "archive")
}

export async function restoreOutlookConversation(channelId: string, externalThreadId: string): Promise<void> {
  await moveConversationMessages(channelId, externalThreadId, "archive", "inbox")
}

export async function trashOutlookConversation(channelId: string, externalThreadId: string): Promise<void> {
  await moveConversationMessages(channelId, externalThreadId, "inbox", "deleteditems")
}

// Reply-draft parity with createGmailDraftForThread: creates a Graph reply
// draft on the latest non-draft message in the conversation (preserves
// threading/subject/recipients), then patches in the body. The draft sits in
// the user's Drafts folder until they send or FlowDesk withdraws it.
export async function createOutlookDraftReply(
  channelId: string,
  input: { externalThreadId: string; body: string }
): Promise<string> {
  const token = await getOutlookAccessToken(channelId)
  const params = new URLSearchParams({
    $filter: `conversationId eq '${input.externalThreadId.replace(/'/g, "''")}' and isDraft eq false`,
    $orderby: "receivedDateTime desc",
    $top: "1",
    $select: "id",
  })
  const latest = await graphGet<{ value: Array<{ id: string }> }>(`/messages?${params}`, token)
  const lastMessageId = latest.value?.[0]?.id
  if (!lastMessageId) throw new Error("No Outlook message found to draft a reply to")

  const draft = await graphRequest<{ id: string }>(
    `/me/messages/${lastMessageId}/createReply`,
    token,
    { method: "POST" }
  )
  await graphRequest(`/me/messages/${draft.id}`, token, {
    method: "PATCH",
    body: { body: { contentType: "Text", content: input.body } },
  })
  return draft.id
}

export async function deleteOutlookDraft(channelId: string, draftId: string): Promise<void> {
  const token = await getOutlookAccessToken(channelId)
  try {
    await graphRequest(`/me/messages/${draftId}`, token, { method: "DELETE" })
  } catch (err) {
    if (err instanceof MicrosoftGraphError && err.status === 404) return
    throw err
  }
}
```

Note: `graphGet` resolves relative paths against `/me` already; `graphRequest` resolves against the Graph root, hence the explicit `/me/...` there (see `lib/microsoft.ts:162,180`). Match the tests to that reality — the test expectations above assume this split; adjust paths in tests if implementation uses the other helper.

- [ ] **Step 3: Run** `npx vitest run tests/outlook-mailbox.test.ts` → PASS.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: Outlook mailbox operations (categories, archive, read, drafts)"`

---

### Task 4: Writeback adapter + generalized processor

**Files:**
- Create: `lib/email/writeback-adapter.ts`
- Rename+modify: `lib/agent/gmail-writeback-processor.ts` → `lib/agent/email-writeback-processor.ts`
- Modify importers: `lib/scheduler/jobs.ts` (import path + job name `gmail-writeback` → `email-writeback`), `app/api/cron/gmail-writeback/route.ts` (import path; route path unchanged), `lib/gmail-labels.ts` (dynamic import path)
- Test: `tests/email-writeback-adapter.test.ts`; rename+update `tests/gmail-writeback-*.test.ts` mocks to the new module path (keep the files' Gmail scenarios intact)

**Interfaces:**
- Consumes: Task 2 helpers, Task 3 outlook functions, existing `lib/google.ts` functions.
- Produces:
  - `type EmailWritebackAdapter = { provider: "google" | "microsoft"; auditPrefix: "gmail" | "outlook"; ensureLabels(channelId: string): Promise<void>; applyLabels(channelId: string, externalThreadId: string, labels: FlowDeskLabelName[]): Promise<void>; markConversationRead(channelId: string, providerMessageIds: string[], context: { tenantId: string; conversationId: string }): Promise<void>; archiveConversation(channelId: string, externalThreadId: string): Promise<void>; restoreConversation(channelId: string, externalThreadId: string): Promise<void>; trashConversation(channelId: string, externalThreadId: string): Promise<void>; createDraftReply(channelId: string, input: { externalThreadId: string; channelEmail: string; body: string }): Promise<string>; deleteDraft(channelId: string, draftId: string): Promise<void> }`
  - `getWritebackAdapter(provider: string | null | undefined): EmailWritebackAdapter | null`
  - Renamed processor exports: `processPendingEmailWritebackJobs(limit = 25)`, `processEmailWritebackJobById(jobId)` (same semantics as the Gmail-named ones).

- [ ] **Step 1: Implement `lib/email/writeback-adapter.ts`**

```ts
import {
  applyFlowDeskLabelsToGmailThread,
  archiveGmailThread,
  createGmailDraftForThread,
  deleteGmailDraft,
  markGmailThreadRead,
  ensureFlowDeskLabels,
  trashGmailThread,
  unarchiveGmailThread,
} from "@/lib/google"
import {
  applyFlowDeskCategoriesToConversation,
  archiveOutlookConversation,
  createOutlookDraftReply,
  deleteOutlookDraft,
  ensureFlowDeskCategories,
  markOutlookConversationRead,
  restoreOutlookConversation,
  trashOutlookConversation,
} from "@/lib/outlook-mailbox"
import type { FlowDeskLabelName } from "@/lib/gmail-labels"

export type EmailWritebackAdapter = {
  provider: "google" | "microsoft"
  auditPrefix: "gmail" | "outlook"
  ensureLabels(channelId: string): Promise<void>
  applyLabels(channelId: string, externalThreadId: string, labels: FlowDeskLabelName[]): Promise<void>
  markConversationRead(
    channelId: string,
    providerMessageIds: string[],
    context: { tenantId: string; conversationId: string }
  ): Promise<void>
  archiveConversation(channelId: string, externalThreadId: string): Promise<void>
  restoreConversation(channelId: string, externalThreadId: string): Promise<void>
  trashConversation(channelId: string, externalThreadId: string): Promise<void>
  createDraftReply(
    channelId: string,
    input: { externalThreadId: string; channelEmail: string; body: string }
  ): Promise<string>
  deleteDraft(channelId: string, draftId: string): Promise<void>
}

const googleAdapter: EmailWritebackAdapter = {
  provider: "google",
  auditPrefix: "gmail",
  ensureLabels: (channelId) => ensureFlowDeskLabels(channelId),
  applyLabels: (channelId, threadId, labels) =>
    applyFlowDeskLabelsToGmailThread(channelId, threadId, labels),
  markConversationRead: (channelId, ids, context) => markGmailThreadRead(channelId, ids, context),
  archiveConversation: (channelId, threadId) => archiveGmailThread(channelId, threadId),
  restoreConversation: (channelId, threadId) => unarchiveGmailThread(channelId, threadId),
  trashConversation: (channelId, threadId) => trashGmailThread(channelId, threadId),
  createDraftReply: (channelId, input) => createGmailDraftForThread(channelId, input),
  deleteDraft: (channelId, draftId) => deleteGmailDraft(channelId, draftId),
}

const microsoftAdapter: EmailWritebackAdapter = {
  provider: "microsoft",
  auditPrefix: "outlook",
  ensureLabels: (channelId) => ensureFlowDeskCategories(channelId),
  applyLabels: (channelId, threadId, labels) =>
    applyFlowDeskCategoriesToConversation(channelId, threadId, labels),
  markConversationRead: (channelId, ids) => markOutlookConversationRead(channelId, ids),
  archiveConversation: (channelId, threadId) => archiveOutlookConversation(channelId, threadId),
  restoreConversation: (channelId, threadId) => restoreOutlookConversation(channelId, threadId),
  trashConversation: (channelId, threadId) => trashOutlookConversation(channelId, threadId),
  createDraftReply: (channelId, input) =>
    createOutlookDraftReply(channelId, { externalThreadId: input.externalThreadId, body: input.body }),
  deleteDraft: (channelId, draftId) => deleteOutlookDraft(channelId, draftId),
}

export function getWritebackAdapter(
  provider: string | null | undefined
): EmailWritebackAdapter | null {
  if (provider === "google") return googleAdapter
  if (provider === "microsoft") return microsoftAdapter
  return null
}
```

(`createGmailDraftForThread` already takes `{ externalThreadId, channelEmail, body }` — see `lib/agent/gmail-writeback-processor.ts:158`.)

- [ ] **Step 2: `git mv lib/agent/gmail-writeback-processor.ts lib/agent/email-writeback-processor.ts` and generalize it**

Changes inside the file (everything else stays byte-identical):
1. Rename exports: `processPendingGmailWritebackJobs` → `processPendingEmailWritebackJobs`, `processGmailWritebackJobById` → `processEmailWritebackJobById`.
2. `recordWritebackResolution` gains an `auditPrefix: "gmail" | "outlook"` parameter; `action:` becomes `` `${auditPrefix}.writeback.${outcome}` ``.
3. `runWritebackJob` starts by loading the channel provider and resolving the adapter:

```ts
async function runWritebackJob(job: FullWritebackJob): Promise<{ ok: boolean }> {
  const channel = await prisma.channel.findUnique({
    where: { id: job.channelId },
    select: { provider: true },
  })
  const adapter = getWritebackAdapter(channel?.provider)
  if (!adapter) {
    await prisma.emailWritebackQueue.update({
      where: { id: job.id },
      data: { status: "completed", lastError: null },
    })
    await recordWritebackResolution(job, "completed", "gmail", {
      result: "skipped",
      detail: { reason: "channel provider does not support mailbox writeback" },
    })
    return { ok: true }
  }
  // ... existing dispatch, with provider calls swapped:
  //   markGmailThreadRead(...)              → adapter.markConversationRead(...)
  //   applyFlowDeskLabelsToGmailThread(...) → adapter.applyLabels(job.channelId, payload.threadId, payload.labels)
  //   handleCreateDraft(job)                → handleCreateDraft(job, adapter)
  //   handleWithdrawDraft(job)              → handleWithdrawDraft(job, adapter)
  // and every recordWritebackResolution call passing adapter.auditPrefix.
}
```

4. `handleCreateDraft(job, adapter)`: replace the provider gate at old line 91 with `if (!getWritebackAdapter(conversation.channel?.provider) || !conversation.externalThreadId)` → skip "not a mailbox-writeback thread"; replace `createGmailDraftForThread`/`deleteGmailDraft` with `adapter.createDraftReply`/`adapter.deleteDraft`. Metadata keys: write neutral `providerDraftId`, `providerDraftSourceInboundMessageId`, `providerDraftSourceInboundAt`; when clearing, delete BOTH neutral and legacy `gmailDraftId*` keys. Audit detail key: `providerDraftId`.
5. `handleWithdrawDraft(job, adapter)`: read draft id via the generalized helper (Task 5 updates `gmailDraftIdFromMetadata` → `providerDraftIdFromMetadata` with legacy fallback — in THIS task, add the fallback read inline: `const draftId = providerDraftIdFromMetadata(draft.metadataJson)`), delete via `adapter.deleteDraft`.
6. Unknown-action failure copy: "Unknown email writeback action".
7. Error message defaults: "Unknown email writeback error"; log tags `[email-writeback]`.

Add to `lib/gmail-drafts.ts` (still its home until Task 5 touches it):

```ts
/** Neutral draft-id accessor: new writes use providerDraftId; legacy Gmail rows used gmailDraftId. */
export function providerDraftIdFromMetadata(metadataJson: unknown): string | null {
  if (!metadataJson || typeof metadataJson !== "object" || Array.isArray(metadataJson)) return null
  const record = metadataJson as Record<string, unknown>
  const value = record.providerDraftId ?? record.gmailDraftId
  return typeof value === "string" && value.length > 0 ? value : null
}
```

Keep `gmailDraftIdFromMetadata` exported (existing UI/tests may read it) but reimplement it as `return providerDraftIdFromMetadata(metadataJson)`.

Also update `handleCreateDraft`'s "created for source" read to check `providerDraftSourceInboundMessageId ?? gmailDraftSourceInboundMessageId`.

8. Update importers: `lib/scheduler/jobs.ts` (`processPendingGmailWritebackJobs` → `processPendingEmailWritebackJobs` from the new path; registry entry `name: "gmail-writeback"` → `"email-writeback"`), `app/api/cron/gmail-writeback/route.ts` (new import; HTTP path unchanged), `lib/gmail-labels.ts` dynamic import → `@/lib/agent/email-writeback-processor` / `processEmailWritebackJobById`.

- [ ] **Step 3: Write failing microsoft-dispatch tests** (`tests/email-writeback-adapter.test.ts`)

Mock `@/lib/google`, `@/lib/outlook-mailbox`, and `@/lib/prisma`. Cases:
- `apply_labels` job whose channel is `microsoft` → `applyFlowDeskCategoriesToConversation` called, `applyFlowDeskLabelsToGmailThread` NOT called, audit row `outlook.writeback.completed`.
- same job on a `google` channel → gmail fn called, audit `gmail.writeback.completed`.
- job on a `twilio` channel → completed with `result: "skipped"`, no provider calls.
- `mark_read` microsoft job → `markOutlookConversationRead` receives the raw `providerMessageIdsJson` array.
- `create_draft` microsoft job with proposed draft → `createOutlookDraftReply` called; draft metadata updated with `providerDraftId`.
- failure path: microsoft `apply_labels` throws → attempts incremented, `nextAttemptAt` in the future, audit only after max attempts (3), action `outlook.writeback.failed`.

Follow the prisma-mock pattern of `tests/gmail-writeback-labels.test.ts` (vi.mock `@/lib/prisma` with an object exposing `emailWritebackQueue`, `channel`, `draft`, `auditLog` methods).

- [ ] **Step 4: Update renamed Gmail tests, run everything**

Update `tests/gmail-writeback-*.test.ts` (and any test importing the old processor path — `rg -l 'gmail-writeback-processor' tests/`) to import from `@/lib/agent/email-writeback-processor`, use the new export names, and mock `prisma.channel.findUnique` to return `{ provider: "google" }`. Scenario assertions stay identical.
Run: `npx vitest run tests/email-writeback-adapter.test.ts tests/gmail-writeback-labels.test.ts tests/gmail-writeback-drafts.test.ts tests/gmail-writeback-inline-drain.test.ts tests/gmail-read-writeback.test.ts` → PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: provider-dispatching email writeback processor with Outlook adapter"`

---

### Task 5: Provider-neutral label projection + draft queueing

Open the queue entry points to microsoft and give audits the right prefix.

**Files:**
- Rename+modify: `lib/gmail-labels.ts` → `lib/email-labels.ts` (git mv; update all importers: `rg -l "lib/gmail-labels|@/lib/gmail-labels" --type ts`)
- Modify: `lib/gmail-drafts.ts` (queue functions + audit prefixes; file name kept — it's mostly neutral already and heavily imported)
- Modify: `lib/conversation-labels.ts:361` gate
- Test: update imports in affected tests; extend `tests/gmail-label-projection.test.ts` (or add `tests/email-label-projection.test.ts`) with microsoft cases

**Interfaces:**
- Consumes: `supportsMailboxWriteback`, `auditPrefixForProvider` (Task 2); `processEmailWritebackJobById` (Task 4).
- Produces: same exports as before from `@/lib/email-labels` (all existing names re-exported), with behavior change: `projectFlowDeskLabelsForConversation` and `queueFlowDeskLabelWriteback` now proceed for microsoft channels.

- [ ] **Step 1: `git mv lib/gmail-labels.ts lib/email-labels.ts`**, update every importer path (`tsc` will list stragglers). Keep ALL export names.

- [ ] **Step 2: Generalize the two gates in `lib/email-labels.ts`**

In `projectFlowDeskLabelsForConversation` replace

```ts
if (conversation.channel?.provider !== "google") return null
```

with

```ts
if (!supportsMailboxWriteback(conversation.channel?.provider)) return null
```

and select `provider` through to the queue call. In `queueFlowDeskLabelWriteback`, add `provider: string` to the input type (all callers have the channel loaded — pass it), and derive the audit action:

```ts
const auditPrefix = auditPrefixForProvider(input.provider)
// ...
action: `${auditPrefix}.labels.queued`,
```

Update the doc comments ("for non-Google channels" → "for channels without mailbox writeback support"; "labels in Gmail" → "labels/categories in the user's mailbox"). Callers of `queueFlowDeskLabelWriteback` that must now pass `provider`: `lib/email-labels.ts` itself (projection), `lib/conversation-labels.ts:361` block, `app/api/conversations/[id]/status/route.ts:124` block, `app/api/conversations/[id]/workflow-status/route.ts:73` block (routes widen in Task 7 — in this task just add `provider: conversation.channel.provider` without changing their gates; the gate condition still restricts to google until Task 7 flips it).

In `lib/conversation-labels.ts` change the gate now (it's a lib, not a route):

```ts
if (supportsMailboxWriteback(conversation.channel?.provider) && conversation.externalThreadId) {
```

- [ ] **Step 3: Generalize `lib/gmail-drafts.ts` queue functions**

`queueGmailDraftWriteback` / `queueGmailDraftWithdrawal`: add `provider: string` to inputs; audit actions become `` `${auditPrefixForProvider(input.provider)}.draft.queued` `` / `` `${...}.draft.withdraw_queued` ``. Update the two lib callers to pass provider: `lib/agent/approvals.ts:125` block (gate widens in Task 7) and `app/api/conversations/[id]/draft/suggest/route.ts:316` block (ditto). Comment updates: "user's Gmail drafts folder" → "user's mailbox drafts folder".

- [ ] **Step 4: Tests**

Add microsoft cases to the projection tests: with a `microsoft` channel + automation level 2, `projectFlowDeskLabelsForConversation` queues a job and writes audit `outlook.labels.queued`; with a `twilio` channel it returns null. Update existing tests for the new `provider` input on the queue functions and the moved module path.
Run: `npx vitest run tests/gmail-label-projection.test.ts tests/gmail-labels.test.ts tests/gmail-writeback-drafts.test.ts` (plus any renamed) → PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: open label projection and draft queueing to Outlook channels"`

---

### Task 6: Outlook delta sync additions — categories, unread flag, feedback learning

**Files:**
- Create: `lib/agent/label-feedback-core.ts` (extraction), `lib/agent/outlook-category-feedback.ts`
- Modify: `lib/agent/gmail-label-feedback.ts` (delegate to core), `lib/outlook-sync.ts`, `lib/microsoft.ts` (`GraphMessage` type gains `categories?: string[]`)
- Test: `tests/outlook-category-feedback.test.ts`; existing `tests/outlook-sync.test.ts` extended; `tests/gmail-label-feedback*.test.ts` (if present — `rg -l 'applyGmailLabelFeedback' tests/`) stay green

**Interfaces:**
- Consumes: `normalizeFlowDeskLabelPayload`, `isFlowDeskLabelName` from `@/lib/email-labels`; `prisma.emailWritebackQueue`.
- Produces:
  - `applyLabelFeedbackCore(input: { tenantId; conversationId; added: string[]; removed: string[]; auditAction: string; userStateSource: string }): Promise<{ applied: boolean; kind: "addition" | "removal" | "ignored" }>` — the body of today's `applyGmailLabelFeedback` with the two literals (`"gmail.labels.corrected"`, `"gmail_label"`) parameterized. First `rg -n '"gmail_label"' lib app` — if anything COMPARES against that source value (rather than writing it), keep the Gmail value for both providers and drop the `userStateSource` param; otherwise Outlook passes `"outlook_category"`.
  - `applyGmailLabelFeedback(...)` — unchanged signature, now `applyLabelFeedbackCore({ ...input, auditAction: "gmail.labels.corrected", userStateSource: "gmail_label" })`.
  - `applyOutlookCategoryFeedback(input: { tenantId: string; conversationId: string; messageCategories: string[] }): Promise<{ applied: boolean }>` — computes added/removed vs the desired set, then calls the core.
  - `runOutlookDeltaSync` behavior additions (same signature).

- [ ] **Step 1: Extract the core**

Move the body of `applyGmailLabelFeedback` (lib/agent/gmail-label-feedback.ts:67–212) into `lib/agent/label-feedback-core.ts` as `applyLabelFeedbackCore`, replacing the audit literal with `input.auditAction` and the `"gmail_label"` source literal with `input.userStateSource`. The echo-consumption block (`latestWriteback` completed → acknowledged) and `ClassificationCorrection` learning move with it verbatim. `gmail-label-feedback.ts` becomes a thin wrapper. Note the file references `gmailLabelOverride` metadata — the override key intentionally stays shared across providers (documented in the core's header comment).

- [ ] **Step 2: Implement `lib/agent/outlook-category-feedback.ts`**

```ts
import { prisma } from "@/lib/prisma"
import { applyLabelFeedbackCore } from "@/lib/agent/label-feedback-core"
import {
  FLOWDESK_LABEL_NAMES,
  normalizeFlowDeskLabelPayload,
} from "@/lib/email-labels"

const FLOWDESK_SET = new Set<string>(FLOWDESK_LABEL_NAMES)

// Outlook's delta feed reports each changed message's full current categories
// rather than add/remove events, so user edits are detected by diffing the
// message's FlowDesk categories against the set FlowDesk last projected (the
// conversation's apply_labels queue payload). Only runs once that job has
// settled (completed/acknowledged/failed): while a projection is pending or
// processing, the mailbox legitimately lags the desired set and any diff
// would be a phantom "user edit". No settled projection → nothing to diff
// against (FlowDesk never labeled this thread) → ignore.
export async function applyOutlookCategoryFeedback(input: {
  tenantId: string
  conversationId: string
  messageCategories: string[]
}): Promise<{ applied: boolean }> {
  const job = await prisma.emailWritebackQueue.findUnique({
    where: {
      conversationId_action: { conversationId: input.conversationId, action: "apply_labels" },
    },
    select: { status: true, providerMessageIdsJson: true },
  })
  if (!job || job.status === "pending" || job.status === "processing") return { applied: false }

  const payload = normalizeFlowDeskLabelPayload(job.providerMessageIdsJson)
  if (!payload) return { applied: false }

  const desired = new Set<string>(payload.labels)
  const actual = input.messageCategories.filter((category) => FLOWDESK_SET.has(category))
  const added = actual.filter((category) => !desired.has(category))
  const removed = [...desired].filter((category) => !actual.includes(category))
  if (added.length === 0 && removed.length === 0) return { applied: false }

  const result = await applyLabelFeedbackCore({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    added,
    removed,
    auditAction: "outlook.labels.corrected",
    userStateSource: "outlook_category",
  })
  return { applied: result.applied }
}
```

- [ ] **Step 3: Extend `lib/outlook-sync.ts`**

1. `DELTA_FIELDS` gains `"categories"` (isRead is already selected); `GraphMessage` in `lib/microsoft.ts` gains `categories?: string[]`.
2. In `applyLiveMessage`, after the message upsert:
   - Recompute the conversation's provider-unread flag (parity with Gmail's `gmailUnread`, which despite the name is the generic "unread in the provider mailbox" flag):

```ts
const unreadInbound = await prisma.message.count({
  where: { conversationId: conversation.id, direction: "inbound", isRead: false },
})
await prisma.conversation.update({
  where: { id: conversation.id },
  data: { gmailUnread: unreadInbound > 0 },
})
```

   (Fold this into the existing `lastMessageAt` update where possible to avoid an extra write.)
   - Collect feedback candidates: return the message's categories to the caller via a new optional out-param `feedback: Array<{ conversationId: string; categories: string[] }>` — only for `direction === "inbound"` messages that ALREADY existed (an update, not a create; check by reading the upsert's prior existence with a `findUnique` on `providerMessageId` before the upsert, which the function already effectively does for removed messages — add `const existed = !!(await prisma.message.findUnique({ where: { providerMessageId }, select: { id: true } }))`). New messages get their categories from projection, not the user.
3. In `runOutlookDeltaSync`, after the `syncConversationWorkItems` fan-out, run feedback for collected candidates (deduped by conversationId, last write wins):

```ts
for (const item of feedbackCandidates.values()) {
  await applyOutlookCategoryFeedback({
    tenantId,
    conversationId: item.conversationId,
    messageCategories: item.categories,
  }).catch(() => undefined)
}
```

Import `applyOutlookCategoryFeedback` via dynamic `await import(...)` inside the function ONLY if a static import creates a cycle (`outlook-sync` ← `outlook-category-feedback` → `email-labels` → dynamic → processor → adapter → `outlook-mailbox`; no path back to `outlook-sync`, so a static import is expected to be safe — verify with `npx tsc --noEmit`).

- [ ] **Step 4: Tests**

`tests/outlook-category-feedback.test.ts` (mock prisma + label-feedback-core):
- settled `apply_labels` job desired `["Needs Reply"]`, message categories `["Needs Reply","Handled","Custom"]` → core called with `added: ["Handled"]`, `removed: []`.
- desired `["Needs Reply"]`, categories `["Custom"]` → `added: []`, `removed: ["Needs Reply"]`.
- pending job → core NOT called.
- no job → core NOT called.
- categories exactly desired → core NOT called.
Extend `tests/outlook-sync.test.ts`: an updated (pre-existing) inbound message with changed categories triggers feedback; a brand-new message does not; conversation `gmailUnread` flips to false when the last unread inbound flips `isRead: true`.
Run: `npx vitest run tests/outlook-category-feedback.test.ts tests/outlook-sync.test.ts` → PASS. Run any gmail feedback tests → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: Outlook category feedback learning and unread tracking from delta sync"`

---

### Task 7: Conversation action routes accept Outlook

**Files:**
- Modify: `app/api/conversations/[id]/archive/route.ts`, `.../trash/route.ts`, `.../read/route.ts`, `.../status/route.ts`, `.../workflow-status/route.ts`, `.../draft/suggest/route.ts`, `lib/agent/approvals.ts`, `lib/agent/follow-up.ts:240`
- Test: `tests/outlook-action-routes.test.ts` (new); existing route tests (`rg -l 'archive/route|trash/route' tests/`) stay green

**Interfaces:**
- Consumes: `getWritebackAdapter` (Task 4), `supportsMailboxWriteback` (Task 2), provider-passing queue functions (Task 5).

- [ ] **Step 1: Widen each gate**

Pattern for archive (`archive/route.ts:32-37`) and trash (same shape):

```ts
const adapter = getWritebackAdapter(conversation.channel.provider)
if (!adapter || !conversation.externalThreadId) {
  return NextResponse.json(
    { error: "Archive is not supported for this channel" },
    { status: 400 }
  )
}
await adapter.archiveConversation(conversation.channelId, conversation.externalThreadId)
```

read route (`read/route.ts:46`): `if (read && adapter)` → `adapter.markConversationRead(conversation.channelId, ids, { tenantId, conversationId })` (keep the existing `.catch` best-effort logging; the warn copy becomes "Failed to mark thread read after read toggle").
status route (`status/route.ts` both blocks): mark-read block uses the adapter; label block condition `provider === "google"` → `supportsMailboxWriteback(provider) && conversation.externalThreadId`, passing `provider` to `queueFlowDeskLabelWriteback`.
workflow-status route: same widening for the label block and the draft-withdrawal block (`queueGmailDraftWithdrawal` now receives `provider`).
draft/suggest route (`:316`): condition → `supportsMailboxWriteback(...) && externalThreadId`; comment "Push the draft into the user's Gmail" → "user's mailbox". Pass `provider` to `queueGmailDraftWriteback`.
approvals.ts (`:125`): `if (conversation?.channel?.provider === "google")` → `if (supportsMailboxWriteback(conversation?.channel?.provider))`, pass provider through.
follow-up.ts (`:240`): `channel: { provider: "google" }` → `channel: { provider: { in: ["google", "microsoft"] } }` (its projection call is already provider-safe after Task 5).

- [ ] **Step 2: Tests** (`tests/outlook-action-routes.test.ts`)

Follow the auth/prisma mocking pattern of the existing route tests. Cases: archive on a microsoft conversation → 200 and `archiveOutlookConversation` called (mock `@/lib/outlook-mailbox`); archive on a twilio/sms conversation → 400; trash microsoft → moves to deleteditems; read toggle microsoft → `markOutlookConversationRead` called.
Run: `npx vitest run tests/outlook-action-routes.test.ts` plus the existing gmail route tests → PASS.

- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat: conversation archive/trash/read/status/draft actions for Outlook"`

---

### Task 8: Clean Inbox bulk archive/unsubscribe for Outlook

**Files:**
- Rename+modify: `lib/clean-inbox-gmail.ts` → `lib/clean-inbox-email.ts`
- Modify: `app/api/clean-inbox/archive-batch/route.ts`, `app/api/clean-inbox/unsubscribe-batch/route.ts`, `app/api/clean-inbox/undo/[batchToken]/route.ts`, `lib/cleanup-candidates.ts:191` area (verify microsoft conversations flow into candidates — the outlook fields at `:207-214` already read; adjust the `provider === "google"` branch to also accept microsoft where it only guards "is this an email channel we can act on")
- Test: rename/extend `tests/` clean-inbox tests (`rg -l 'clean-inbox-gmail' tests/`)

**Interfaces:**
- Produces from `@/lib/clean-inbox-email`:
  - `archivableInProviderMailbox<T>(convs: T[]): T[]` — filter: `supportsMailboxWriteback(c.channel?.provider) && !!c.externalThreadId`
  - `archiveConversationsInProviderMailbox(convs): Promise<{ archived: string[]; failed: string[] }>`
  - `restoreConversationsInProviderMailbox(convs): Promise<{ archived: string[]; failed: string[] }>`
  - Keep legacy export names as thin aliases so route diffs stay small if any external import was missed: `archiveConversationsInGmail = archiveConversationsInProviderMailbox` etc. (then update the three routes to the new names anyway).

- [ ] **Step 1: `git mv lib/clean-inbox-gmail.ts lib/clean-inbox-email.ts`** and generalize: the per-conversation call becomes

```ts
const adapter = getWritebackAdapter(conv.channel?.provider)
if (!adapter) return
await adapter.archiveConversation(conv.channelId, conv.externalThreadId as string)   // or restoreConversation
```

inside the same best-effort per-item try/catch. Update the module/function doc comments ("leaves the user's Gmail" → "leaves the user's mailbox"; note the Outlook wrinkle: moving messages out of Inbox means the inbox-scoped delta feed later reports them `@removed`, which is fine because the caller closes the conversation locally first, and undo re-syncs them).

- [ ] **Step 2: Update the three clean-inbox routes** to the new import path/names. No logic changes — the filter function now simply admits microsoft conversations.

- [ ] **Step 3: `lib/cleanup-candidates.ts`** — read the `provider === "google"` branch at `:191`; if it only chooses which credential/sync fields to read (google vs outlook are both handled per `:207-214`), no change; if it gates candidate INCLUSION to google, widen with `supportsMailboxWriteback`. Follow what the surrounding code actually does.

- [ ] **Step 4: Tests**

Extend the clean-inbox tests: a mixed batch (google + microsoft + sms) archives google via `archiveGmailThread`-backed adapter and microsoft via `archiveOutlookConversation`, skips sms; a failed microsoft archive lands in `failed` without failing the batch; undo restores both providers.
Run: `npx vitest run` on the clean-inbox test files → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: clean-inbox bulk archive and undo for Outlook channels"`

---

### Task 9: Reconcile crons + relabel for Outlook; scheduler registry

**Files:**
- Rename+modify: `lib/agent/gmail-label-reconcile.ts` → `lib/agent/email-label-reconcile.ts`; `lib/agent/gmail-state-reconcile.ts` → `lib/agent/email-state-reconcile.ts`
- Modify: `lib/scheduler/jobs.ts`, `app/api/cron/gmail-label-reconcile/route.ts`, `app/api/cron/gmail-state-reconcile/route.ts` (import paths only), `app/api/connectors/gmail/relabel/route.ts` (shared handler extraction)
- Create: `app/api/connectors/outlook/relabel/route.ts`
- Test: update renamed cron tests; add microsoft cases

**Interfaces:**
- Produces:
  - `reconcileLabelsForChannel(channel: { id: string; tenantId: string; provider: string }, options: { windowDays: number; batchSize: number })` — as today but `ensureFlowDeskLabels(channel.id)` → `getWritebackAdapter(channel.provider)!.ensureLabels(channel.id)`.
  - `runEmailLabelReconcileCron()` — channel query becomes:

```ts
const channels = await prisma.channel.findMany({
  where: {
    OR: [
      { provider: "google", gmailCredential: { isNot: null } },
      { provider: "microsoft", outlookCredential: { isNot: null } },
    ],
  },
  select: { id: true, tenantId: true, provider: true },
})
```

  ensure-failure audit action becomes `` `${auditPrefixForProvider(channel.provider)}.labels.ensure_failed` ``.
  - `runEmailStateReconcileCron()` — drift query `channel: { provider: "google" }` → `channel: { provider: { in: ["google", "microsoft"] } }`; audit `driftType` stays `"local_read_gmail_unread"` for google and becomes `"local_read_provider_unread"` for microsoft (select `channel: { select: { provider: true } }` in the query); the queued `mark_read` row is provider-agnostic already (Task 4 processor dispatches it).
- Scheduler registry (`lib/scheduler/jobs.ts`): names `gmail-state-reconcile` → `email-state-reconcile`, `gmail-label-reconcile` → `email-label-reconcile` with the new imports (intervals unchanged). `gmail-push-retry`, `gmail-watch`, `outlook-sync` stay as-is.

- [ ] **Step 1: Renames + generalization above.** Cron HTTP route paths stay (`/api/cron/gmail-label-reconcile` etc.) — only their imports change; add a one-line comment that the route name is historical and the job covers all email providers.

- [ ] **Step 2: Relabel routes.** Extract the body of `app/api/connectors/gmail/relabel/route.ts` into a small shared helper in `lib/agent/email-label-reconcile.ts`:

```ts
export async function runRelabelCatchUp(input: {
  tenantId: string
  provider: "google" | "microsoft"
}): Promise<{ channels: number; scanned: number; queued: number; errors: number; labelsEnsured: number }>
```

which finds the tenant's channels of that provider (with the matching credential non-null) and calls `reconcileLabelsForChannel(channel, { windowDays: 365, batchSize: 100 })` per channel (copy the exact windowDays/batchSize the gmail relabel route uses today — read it first). The gmail route becomes a thin session-authed wrapper calling it with `provider: "google"`; the new `app/api/connectors/outlook/relabel/route.ts` is the same wrapper with `provider: "microsoft"` (copy the gmail route's session/authorization checks verbatim).

- [ ] **Step 3: Tests.** Update renamed test imports (`rg -l 'gmail-label-reconcile|gmail-state-reconcile' tests/`). Add: cron over one google + one microsoft channel ensures labels via the right adapter for each; state-reconcile queues `mark_read` for a user-read microsoft conversation with `gmailUnread: true`. Run those files → PASS.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: provider-neutral label/state reconcile crons and Outlook relabel"`

---

### Task 10: Outlook worker error recording (docs/TODO.md:90)

**Files:**
- Modify: `lib/outlook-worker.ts`
- Test: extend `tests/outlook-worker.test.ts`

- [ ] **Step 1: Replace the two bare catch blocks** (`outlook-worker.ts:106-108` renewal loop, `:134-136` fallback loop):
  - Renewal failure: `errors++`, set `subscriptionError` to the error message + `subscriptionLastRenewalAttempt: new Date()` on the credential, write audit `outlook.subscription.renewal_failed` `{ channelId, error }` (best-effort `.catch(() => {})`).
  - Fallback-sync failure: `errors++`, set `lastSyncStatus: "error"`, `lastSyncError: message` on the credential (only when the failure wasn't already recorded by `runOutlookDeltaSync`'s own catch — it records before rethrowing, so the worker only needs the audit), write audit `outlook.sync.failed` `{ channelId, error }`.
  - In both loops, do NOT add the failed channel to `processedChannels` (read the current code: if a failed channel is currently pushed into that set, move the push to the success path).

- [ ] **Step 2: Tests** — renewal helper throwing records `subscriptionError` + audit and keeps processing the next credential; fallback failure doesn't mark the channel processed (a queued event for it is still retried). Run `npx vitest run tests/outlook-worker.test.ts` → PASS.

- [ ] **Step 3: Commit** — `git add -A && git commit -m "fix: record Outlook renewal/sync failure causes instead of swallowing them"`

---

### Task 11: Outlook operator health + settings surface

**Files:**
- Create: `lib/outlook-operator-health.ts`
- Modify: `lib/gmail-operator-health.ts` (export shared types only if not already exported — they are: `GmailOperatorHealthStatus`, `GmailOperatorHealthCheck`, `GmailOperatorHealthSummary`), `app/settings/connect/page.tsx`, `app/settings/GmailOperatorHealthPanel.tsx` (generalize props or add sibling panel), `app/settings/FixGmailLabelsButton.tsx` (generalize target URL via prop, or create `FixOutlookLabelsButton.tsx` mirroring it)
- Test: `tests/outlook-operator-health.test.ts`

**Interfaces:**
- Produces `summarizeOutlookOperatorHealth(input: OutlookOperatorHealthInput): GmailOperatorHealthSummary` where

```ts
export type OutlookOperatorHealthInput = {
  now: Date
  channels: Array<{
    id: string
    emailAddress: string | null
    lastSyncedAt: Date | null
    lastSyncStatus: string | null
    lastSyncError: string | null
    subscriptionExpiresAt: Date | null
    subscriptionError: string | null
  }>
  writebackPending: number
  writebackFailed: number
  oldestPendingWritebackAt: Date | null
  syncEventsFailed: number
}
```

- [ ] **Step 1: Write failing tests** — mirror `tests/gmail-operator-health.test.ts` structure (read it first): healthy when synced recently + subscription >24h out + empty queue; warning when subscription expires <24h or sync stale >1h; critical when `lastSyncError` mentions auth (`invalid_grant`/401 → "Reconnect Outlook") or `writebackFailed > 0`. Reuse the Gmail thresholds (`STALE_SYNC_MS` 1h, `STALE_QUEUE_MS` 30m, warning window 24h) — copy the constants, or export them from the gmail module and import.

- [ ] **Step 2: Implement** as a pure function following `summarizeGmailOperatorHealth`'s check-list shape with checks: `outlook-auth-sync`, `outlook-subscription`, `outlook-writeback` (+ reuse the shared `agent-jobs` check only if the gmail summary doesn't already display it globally — read how the settings page composes it and avoid double-reporting).

- [ ] **Step 3: Wire the settings page** (`app/settings/connect/page.tsx`): where the Gmail health input is assembled (line ~122), assemble the Outlook input when microsoft channels exist (`prisma.emailWritebackQueue` counts scoped to microsoft channels via `channel: { provider: "microsoft" }`, `OutlookSyncEvent` failed count, credential fields) and render the health panel + a "Fix Outlook labels" button (POST `/api/connectors/outlook/relabel`) in the existing Outlook connector card. Reuse the Gmail panel component with props (`title`, `summary`) rather than duplicating markup — read the component first; if it hardcodes Gmail copy, add props with defaults preserving current Gmail rendering.

- [ ] **Step 4:** `npx vitest run tests/outlook-operator-health.test.ts` → PASS; `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: Outlook operator health panel and fix-labels action"`

---

### Task 12: Onboarding + callback parity, wizard provider choice

**Files:**
- Modify: `lib/agent/onboarding-first-pass.ts`, `app/api/connectors/outlook/callback/route.ts`, `app/api/connectors/outlook/sync/route.ts`, `app/onboarding/OnboardingWizard.tsx`, `app/onboarding/page.tsx` (read both fully first), `app/api/connectors/gmail/first-pass/route.ts` (only if it hardcodes provider — read it)
- Test: `tests/onboarding-first-pass.test.ts` extension (find via `rg -l 'onboarding-first-pass' tests/`); `tests/outlook-manual-sync.test.ts` extension

- [ ] **Step 1: Generalize `runOnboardingFirstPass`** — channel query (`:63`) becomes the two-provider OR from Task 9; result field `hadGmail` → rename to `hadEmailChannel` and update ALL consumers (`rg -n 'hadGmail'`): the first-pass route response and `OnboardingWizard.tsx`. The first-pass body (classification + projection) is already provider-safe after Task 5.

- [ ] **Step 2: Outlook callback (`app/api/connectors/outlook/callback/route.ts`)** — three changes:
  1. Fix the copy-paste error redirect `error=google_denied` → `error=outlook_denied` (line ~22).
  2. After the initial delta sync + `ensureOutlookSubscription`, add best-effort `await ensureFlowDeskCategories(channel.id).catch(...)` (parity with gmail callback's `ensureFlowDeskLabels` at its line 107).
  3. Redirect NEW connections to `/onboarding?connected=outlook` (read how the gmail callback decides new-vs-reconnect at its line ~137 and mirror it exactly).

- [ ] **Step 3: Outlook manual sync route** — add `ensureFlowDeskCategories` best-effort before the delta run (parity with gmail sync route line 34).

- [ ] **Step 4: Wizard** — in `OnboardingWizard.tsx`: `STEP_LABELS` "Connect Gmail" → "Connect your inbox"; alongside the Gmail connect button (line ~196, `href="/api/connectors/gmail/connect"`) add an Outlook button `href="/api/connectors/outlook/connect"` rendered when a new `microsoftConfigured: boolean` prop is true (plumb from `app/onboarding/page.tsx` via `Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET)` — mirror how `app/settings/connect/page.tsx:70` computes it); handle `?connected=outlook` the same as the gmail value; provider-neutral copy for the labels step ("Open Gmail to see your labels" → "Open your inbox to see your labels" with per-provider wording if the component knows which provider connected). Keep the existing visual structure — this is a copy + one-button change, not a redesign. Respect the existing personal-account gating pattern (`app/settings/connect/page.tsx:197`) if the page passes it down.

- [ ] **Step 5: Tests** — first-pass runs for a microsoft channel (classifies + queues `outlook.labels.queued` audit); callback test (if one exists — `tests/outlook-*.test.ts`) asserts the new redirect + ensure call. Run affected files → PASS.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: Outlook onboarding first-pass, callback category setup, wizard provider choice"`

---

### Task 13: UI provider affordances

**Files:**
- Modify: `app/components/AppListColumn.tsx:103`, `app/conversations/[id]/page.tsx:206,709`, `app/settings/gmail/page.tsx` + `app/settings/GmailLabelSettingsPanel.tsx` (copy only), `app/settings/connect/page.tsx` (Outlook card: add Sync-style hint that labels are Outlook categories — copy only)
- Test: none beyond `npx tsc --noEmit` (these are conditional-flag and copy changes); extend an existing component test only if one already covers `isGmail`

- [ ] **Step 1:** Read `app/conversations/[id]/page.tsx:200-215` and `:700-715` and `AppListColumn.tsx:95-110` to see what `isGmail` gates (archive/trash/read affordances and provider badges). Where the affordance is now provider-neutral (archive, trash, read, labels), compute `const supportsMailboxActions = supportsMailboxWriteback(conversation.channel.provider)` and use it; keep genuinely Gmail-only affordances (e.g. deep links to mail.google.com) gated on `provider === "google"`, and add the Outlook equivalent (`https://outlook.live.com/mail/` deep link) where one exists.
- [ ] **Step 2:** Label-settings copy: the panel explains labels appear "in Gmail" — update to "in your inbox (Gmail labels / Outlook categories)". The `app/settings/gmail/page.tsx` guard querying only google channels: widen to both providers so Outlook-only tenants can manage the taxonomy (`provider: { in: ["google", "microsoft"] }`).
- [ ] **Step 3:** `npx tsc --noEmit` → clean; `npm test` → green. Commit — `git add -A && git commit -m "feat: surface mailbox actions and label settings for Outlook channels"`

---

### Task 14: Docs, full verification, PR

**Files:**
- Modify: `docs/CURRENT_STATE.md` (lines ~55-63 and ~161: replace "Outlook does not yet have archive/trash writeback" with a short Outlook-parity paragraph: categories projection, writeback queue shared via `EmailWritebackQueue`, archive/trash/read/drafts, feedback, reconcile crons, operator health), `docs/TODO.md` (check off lines 90–91 with one-line "shipped" notes in the established style), `README.md` (only if it documents the writeback queue by name)
- No new doc files (docs policy).

- [ ] **Step 1: Update the living docs** per above.
- [ ] **Step 2: Full gate** — run all three, fix anything that surfaces:

```bash
npm test && npx tsc --noEmit && npm run lint
```

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/outlook-parity
gh pr create --title "feat: Outlook feature parity — categories, clean inbox, drafts, reconcile" --body "<summary per repo conventions>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

PR body: summarize the adapter architecture, the `EmailWritebackQueue` rename migration (flag it for reviewer attention), the feature list, the TODO items closed (docs/TODO.md:90–91), and note that live Graph verification wasn't possible (no dev Outlook credential) while all suites pass.

- [ ] **Step 4: Commit docs** (before push) — `git add -A && git commit -m "docs: record Outlook parity in living docs"`

---

## Plan Self-Review (completed)

- **Spec coverage:** labels→Task 3/4/5, bulk archive/unsubscribe→8, single-conversation actions→7, drafts→3/4/5, rules reach Outlook→5 (projection) + existing neutral rules engine, feedback→6, state/label reconcile→9, relabel→9, worker error recording→10, operator health→11, onboarding/callback→12, UI→13, docs/PR→14, schema rename→1. Non-goals respected (no sync rewrite, no `GmailLabelMapping` rename — Task 13 only widens the settings page query).
- **Type consistency:** adapter method names (`applyLabels`, `markConversationRead`, `archiveConversation`, `restoreConversation`, `trashConversation`, `createDraftReply`, `deleteDraft`, `ensureLabels`) are used identically in Tasks 4, 7, 8, 9. Queue accessor `prisma.emailWritebackQueue` from Task 1 used thereafter. `supportsMailboxWriteback`/`auditPrefixForProvider` from Task 2 used in 5, 7, 9. Neutral draft metadata keys (`providerDraftId`) written in Task 4, read via `providerDraftIdFromMetadata`.
- **Known judgment calls for implementers:** exact Graph paths in tests must match the `graphGet` (`/me`-rooted) vs `graphRequest` (root-rooted) split; `userStateSource: "outlook_category"` is conditional on the rg check in Task 6; cleanup-candidates change in Task 8 is read-first.
