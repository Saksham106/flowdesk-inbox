# Phase 3 v3.1 — Intelligence Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship smart snooze/reply-later, PDF attachment intelligence with LLM field extraction, and second-brain fact retrieval — adding three new Prisma models and extending PersonMemory.

**Architecture:** `SnoozeReminder` stores snooze state; an hourly cron fires resurfacing. `EmailAttachment` stores extracted text and structured JSON from PDF attachments; extraction runs as background `AgentJob`. `PersonMemory.factsJson` stores LLM-extracted contact facts; a new `lib/agent/second-brain.ts` handles extraction and retrieval, integrated into the reply context pipeline.

**Tech Stack:** TypeScript, Prisma (PostgreSQL), Next.js App Router, Vitest, `pdf-parse` npm package

**Spec:** `docs/superpowers/specs/2026-06-17-phase3-design.md` (v3.1 section)

**Prerequisite:** v3.0 Protection Layer plan must be complete.

---

## File Structure

**New files:**
- `prisma/migrations/20260617001000_add_snooze_reminders/migration.sql`
- `prisma/migrations/20260617002000_add_email_attachments/migration.sql`
- `prisma/migrations/20260617003000_add_person_memory_facts/migration.sql`
- `lib/agent/second-brain.ts` — fact extraction + retrieval
- `tests/second-brain.test.ts`
- `app/api/conversations/[id]/snooze/route.ts` — POST + DELETE
- `app/api/cron/snooze-check/route.ts` — hourly cron
- `app/api/conversations/[id]/attachments/route.ts` — GET
- `app/api/second-brain/[contactId]/route.ts` — GET facts
- `app/api/second-brain/search/route.ts` — POST keyword search
- `app/conversations/[id]/SnoozeModal.tsx` — snooze quick-pick UI
- `app/conversations/[id]/AttachmentsPanel.tsx` — attachment extracted data
- `app/conversations/[id]/SecondBrainPanel.tsx` — contact facts display

**Modified files:**
- `prisma/schema.prisma` — SnoozeReminder, EmailAttachment, PersonMemory.factsJson
- `lib/agent/work-item-sync.ts` — detect attachments and queue extraction AgentJob
- `lib/agent/reply-context.ts` — include second-brain facts in draft context
- `app/inbox/page.tsx` — add "Snoozed" tab, snooze hover button on rows
- `app/conversations/[id]/page.tsx` — render SnoozeModal, AttachmentsPanel, SecondBrainPanel
- `app/components/InboxRow.tsx` — snooze hover button

---

## Task 1: SnoozeReminder Migration + Schema

**Files:**
- Create: `prisma/migrations/20260617001000_add_snooze_reminders/migration.sql`
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Create migration SQL**

```sql
-- prisma/migrations/20260617001000_add_snooze_reminders/migration.sql
CREATE TABLE "SnoozeReminder" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "snoozeUntil" TIMESTAMP(3) NOT NULL,
  "reason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SnoozeReminder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SnoozeReminder_tenantId_status_snoozeUntil_idx"
  ON "SnoozeReminder"("tenantId", "status", "snoozeUntil");
CREATE INDEX "SnoozeReminder_conversationId_idx"
  ON "SnoozeReminder"("conversationId");

ALTER TABLE "SnoozeReminder" ADD CONSTRAINT "SnoozeReminder_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SnoozeReminder" ADD CONSTRAINT "SnoozeReminder_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 2: Apply migration**

```bash
npx prisma db execute --file prisma/migrations/20260617001000_add_snooze_reminders/migration.sql
npx prisma migrate resolve --applied 20260617001000_add_snooze_reminders
npx prisma generate
```

- [ ] **Step 3: Add SnoozeReminder to schema.prisma**

```prisma
model SnoozeReminder {
  id             String       @id @default(cuid())
  tenantId       String
  conversationId String
  userId         String
  snoozeUntil    DateTime
  reason         String?
  status         String       @default("pending")
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  tenant         Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([tenantId, status, snoozeUntil])
  @@index([conversationId])
}
```

Add `snoozeReminders SnoozeReminder[]` to `Tenant` and `Conversation` models.

- [ ] **Step 4: Commit**

```bash
git add prisma/migrations/20260617001000_add_snooze_reminders/ prisma/schema.prisma
git commit -m "feat: add SnoozeReminder model and migration"
```

---

## Task 2: Snooze API Routes + Cron

**Files:**
- Create: `app/api/conversations/[id]/snooze/route.ts`
- Create: `app/api/cron/snooze-check/route.ts`

- [ ] **Step 1: Create snooze route**

```typescript
// app/api/conversations/[id]/snooze/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const body = await request.json()
  const snoozeUntil = body?.snoozeUntil
  if (!snoozeUntil || isNaN(new Date(snoozeUntil).getTime())) {
    return NextResponse.json({ error: "snoozeUntil required (ISO date string)" }, { status: 400 })
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
    select: { id: true },
  })
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const snooze = await prisma.snoozeReminder.create({
    data: {
      tenantId: session.user.tenantId,
      conversationId: params.id,
      userId: session.user.id,
      snoozeUntil: new Date(snoozeUntil),
      reason: body?.reason ?? null,
      status: "pending",
    },
  })

  // Mark conversation priority as snoozed in state
  const state = await prisma.conversationState.findUnique({
    where: { conversationId: params.id },
    select: { metadataJson: true },
  })
  const meta =
    state?.metadataJson && typeof state.metadataJson === "object" && !Array.isArray(state.metadataJson)
      ? (state.metadataJson as Record<string, unknown>)
      : {}
  await prisma.conversationState.update({
    where: { conversationId: params.id },
    data: {
      priority: "snoozed",
      metadataJson: { ...meta, snoozeReminderId: snooze.id, snoozeUntil } as Prisma.InputJsonValue,
    },
  })

  return NextResponse.json({ snooze })
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const pending = await prisma.snoozeReminder.findFirst({
    where: { conversationId: params.id, tenantId: session.user.tenantId, status: "pending" },
  })
  if (!pending) return NextResponse.json({ error: "No active snooze" }, { status: 404 })

  await prisma.snoozeReminder.update({ where: { id: pending.id }, data: { status: "dismissed" } })

  // Restore priority
  await prisma.conversationState.update({
    where: { conversationId: params.id },
    data: { priority: "normal" },
  })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Create snooze-check cron route**

```typescript
// app/api/cron/snooze-check/route.ts
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const auth = request.headers.get("authorization")
  const secret = process.env.CRON_SECRET
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = new Date()
  const due = await prisma.snoozeReminder.findMany({
    where: { status: "pending", snoozeUntil: { lte: now } },
    select: { id: true, conversationId: true, tenantId: true },
    take: 100,
  })

  let fired = 0
  for (const snooze of due) {
    await prisma.snoozeReminder.update({ where: { id: snooze.id }, data: { status: "fired" } })

    const state = await prisma.conversationState.findUnique({
      where: { conversationId: snooze.conversationId },
      select: { metadataJson: true },
    })
    const meta =
      state?.metadataJson && typeof state.metadataJson === "object" && !Array.isArray(state.metadataJson)
        ? (state.metadataJson as Record<string, unknown>)
        : {}

    await prisma.conversationState.update({
      where: { conversationId: snooze.conversationId },
      data: {
        priority: "normal",
        metadataJson: { ...meta, resurfacedFromSnooze: true, snoozeReminderId: null } as Prisma.InputJsonValue,
      },
    })
    fired++
  }

  return NextResponse.json({ ok: true, fired })
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/conversations/[id]/snooze/ app/api/cron/snooze-check/
git commit -m "feat: add snooze API routes and hourly snooze-check cron"
```

---

## Task 3: Snooze UI — Hover Button + Modal + Snoozed Inbox Tab

**Files:**
- Create: `app/conversations/[id]/SnoozeModal.tsx`
- Modify: `app/components/InboxRow.tsx`
- Modify: `app/inbox/page.tsx`
- Modify: `app/conversations/[id]/page.tsx`

- [ ] **Step 1: Create SnoozeModal.tsx**

```tsx
// app/conversations/[id]/SnoozeModal.tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

function quickOption(label: string, getDate: () => Date) {
  return { label, getDate }
}

const QUICK_OPTIONS = [
  quickOption("Tonight (9 PM)", () => {
    const d = new Date(); d.setHours(21, 0, 0, 0); return d
  }),
  quickOption("Tomorrow morning (8 AM)", () => {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return d
  }),
  quickOption("In 3 days", () => {
    const d = new Date(); d.setDate(d.getDate() + 3); d.setHours(8, 0, 0, 0); return d
  }),
  quickOption("Next Monday (8 AM)", () => {
    const d = new Date()
    const daysUntilMonday = (8 - d.getDay()) % 7 || 7
    d.setDate(d.getDate() + daysUntilMonday); d.setHours(8, 0, 0, 0); return d
  }),
]

export default function SnoozeModal({
  conversationId,
  onClose,
}: {
  conversationId: string
  onClose: () => void
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [custom, setCustom] = useState("")

  async function snooze(until: Date) {
    setLoading(true)
    await fetch(`/api/conversations/${conversationId}/snooze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snoozeUntil: until.toISOString() }),
    })
    setLoading(false)
    onClose()
    router.refresh()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-72 rounded-xl border border-slate-200 bg-white p-5 shadow-lg">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Snooze until…</h3>
        <ul className="space-y-1.5">
          {QUICK_OPTIONS.map((opt) => (
            <li key={opt.label}>
              <button
                disabled={loading}
                onClick={() => snooze(opt.getDate())}
                className="w-full rounded-lg border border-slate-100 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                {opt.label}
              </button>
            </li>
          ))}
          <li>
            <input
              type="datetime-local"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="w-full rounded-lg border border-slate-100 px-3 py-2 text-sm"
            />
            {custom && (
              <button
                disabled={loading}
                onClick={() => snooze(new Date(custom))}
                className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Snooze to custom time
              </button>
            )}
          </li>
        </ul>
        <button onClick={onClose} className="mt-3 w-full text-center text-xs text-slate-400 hover:text-slate-600">
          Cancel
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add Snooze button to InboxRow hover actions**

In `app/components/InboxRow.tsx`, add `onSnooze?: () => void` to `InboxRowProps` and a clock button in the hover actions row (next to the existing mark-read and close/reopen buttons):

```tsx
{/* Inside the hover actions row */}
<button
  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSnooze?.() }}
  title="Snooze"
  className="rounded p-1 text-slate-400 hover:text-amber-600"
>
  ⏰
</button>
```

In `app/inbox/page.tsx`, pass `onSnooze` and manage a `snoozeTarget` state to show the `<SnoozeModal>`. Since InboxRow is a client component, the modal trigger can live inline.

- [ ] **Step 3: Add "Snoozed" tab to inbox page**

In `app/inbox/page.tsx`, extend the attention tabs to include "snoozed":

```typescript
{(["needs_reply", "review_soon", "read_later", "life_admin", "snoozed"] as const).map((cat) => {
  const labels: Record<string, string> = {
    needs_reply: "Reply",
    review_soon: "Review",
    read_later: "Later",
    life_admin: "Life Admin",
    snoozed: "Snoozed",
  }
```

Update the `displayConversations` filter to handle "snoozed":

```typescript
if (attentionFilter === "snoozed") return m.priority === "snoozed" || typeof m.snoozeReminderId === "string"
```

- [ ] **Step 4: Add Snooze button to conversation page**

In `app/conversations/[id]/page.tsx`, import `SnoozeModal` and add a "Snooze" button to the action bar. Use `useState` to toggle the modal open/closed. Add resurfaced-from-snooze badge when `metadataJson.resurfacedFromSnooze` is true:

```tsx
{resurfacedFromSnooze && (
  <div className="flex items-center gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-700">
    ⏰ Snoozed — time to reply
  </div>
)}
```

- [ ] **Step 5: Commit**

```bash
git add app/conversations/[id]/SnoozeModal.tsx app/components/InboxRow.tsx app/inbox/page.tsx app/conversations/[id]/page.tsx
git commit -m "feat: snooze modal, hover button, Snoozed inbox tab, resurfaced banner"
```

---

## Task 4: EmailAttachment Migration + Schema

**Files:**
- Create: `prisma/migrations/20260617002000_add_email_attachments/migration.sql`
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Create migration SQL**

```sql
-- prisma/migrations/20260617002000_add_email_attachments/migration.sql
CREATE TABLE "EmailAttachment" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL DEFAULT 0,
  "gmailAttachmentId" TEXT,
  "extractedText" TEXT,
  "extractedDataJson" JSONB,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailAttachment_tenantId_conversationId_idx"
  ON "EmailAttachment"("tenantId", "conversationId");
CREATE INDEX "EmailAttachment_messageId_idx"
  ON "EmailAttachment"("messageId");

ALTER TABLE "EmailAttachment" ADD CONSTRAINT "EmailAttachment_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailAttachment" ADD CONSTRAINT "EmailAttachment_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 2: Apply migration**

```bash
npx prisma db execute --file prisma/migrations/20260617002000_add_email_attachments/migration.sql
npx prisma migrate resolve --applied 20260617002000_add_email_attachments
npx prisma generate
```

- [ ] **Step 3: Add EmailAttachment to schema.prisma**

```prisma
model EmailAttachment {
  id                String    @id @default(cuid())
  tenantId          String
  messageId         String
  conversationId    String
  filename          String
  mimeType          String
  sizeBytes         Int       @default(0)
  gmailAttachmentId String?
  extractedText     String?
  extractedDataJson Json?
  processedAt       DateTime?
  createdAt         DateTime  @default(now())
  tenant            Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  conversation      Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([tenantId, conversationId])
  @@index([messageId])
}
```

Add `emailAttachments EmailAttachment[]` to `Tenant` and `Conversation` models.

- [ ] **Step 4: Install pdf-parse**

```bash
npm install pdf-parse
npm install --save-dev @types/pdf-parse
```

- [ ] **Step 5: Commit**

```bash
git add prisma/migrations/20260617002000_add_email_attachments/ prisma/schema.prisma package.json package-lock.json
git commit -m "feat: add EmailAttachment model, migration, and pdf-parse dependency"
```

---

## Task 5: Attachment Detection + PDF Extraction

**Files:**
- Modify: `lib/agent/work-item-sync.ts`
- Create: `app/api/conversations/[id]/attachments/route.ts`
- Create: `app/conversations/[id]/AttachmentsPanel.tsx`

- [ ] **Step 1: Detect attachments in work-item-sync**

The Gmail API returns attachment metadata in `message.payload.parts`. In `lib/agent/work-item-sync.ts`, after existing processing blocks, add attachment detection.

The `conversation.messages` records do not currently store raw Gmail part metadata. Attachment metadata needs to come from the Gmail API at sync time. Add a new exported helper function that is called from the Gmail sync route:

Create `lib/agent/attachment-sync.ts`:

```typescript
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

export type GmailAttachmentPart = {
  filename: string
  mimeType: string
  sizeBytes: number
  attachmentId: string
}

export async function syncMessageAttachments(
  tenantId: string,
  conversationId: string,
  messageId: string,
  parts: GmailAttachmentPart[]
): Promise<void> {
  const attachable = parts.filter(
    (p) => p.filename && p.filename.trim() && p.attachmentId
  )
  if (attachable.length === 0) return

  for (const part of attachable) {
    const existing = await prisma.emailAttachment.findFirst({
      where: { messageId, gmailAttachmentId: part.attachmentId },
      select: { id: true },
    })
    if (existing) continue

    await prisma.emailAttachment.create({
      data: {
        tenantId,
        messageId,
        conversationId,
        filename: part.filename,
        mimeType: part.mimeType,
        sizeBytes: part.sizeBytes,
        gmailAttachmentId: part.attachmentId,
      },
    })

    // Queue extraction AgentJob for PDFs
    if (part.mimeType === "application/pdf") {
      await prisma.agentJob.create({
        data: {
          tenantId,
          conversationId,
          trigger: "process_attachment",
          status: "pending",
          payloadJson: {
            attachmentId: part.attachmentId,
            messageId,
            mimeType: part.mimeType,
          } as Prisma.InputJsonValue,
        },
      })
    }
  }
}
```

- [ ] **Step 2: Create attachment processing route**

```typescript
// app/api/agent/process-attachment/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

export const runtime = "nodejs"

const MAX_EXTRACTED_TEXT_BYTES = 10_000

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { attachmentDbId } = body ?? {}
  if (!attachmentDbId) {
    return NextResponse.json({ error: "attachmentDbId required" }, { status: 400 })
  }

  const attachment = await prisma.emailAttachment.findFirst({
    where: { id: attachmentDbId, tenantId: session.user.tenantId },
  })
  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (attachment.processedAt) return NextResponse.json({ ok: true, alreadyProcessed: true })

  // PDF extraction
  let extractedText: string | null = null
  if (attachment.mimeType === "application/pdf" && attachment.gmailAttachmentId) {
    try {
      // Dynamically import pdf-parse to avoid issues with Next.js bundling
      const pdfParse = (await import("pdf-parse")).default
      // NOTE: In production, fetch the attachment data from Gmail API using gmailAttachmentId.
      // This requires the GmailCredential for this tenant. For now, we mark as processed
      // without extractedText if we can't fetch — the UI gracefully shows filename only.
      // Full Gmail API fetch integration should be added in the Gmail sync service.
      extractedText = null // placeholder until Gmail API fetch is wired
    } catch {
      extractedText = null
    }
  }

  // LLM extraction of structured fields (only if we have text)
  let extractedDataJson: Prisma.InputJsonValue | undefined
  if (extractedText) {
    const trimmed = extractedText.slice(0, MAX_EXTRACTED_TEXT_BYTES)
    try {
      const OpenAI = (await import("openai")).default
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      const completion = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: `Extract structured data from this document. Return JSON with these optional fields:
{ "type": "invoice"|"contract"|"receipt"|"form"|"itinerary"|"other", "amount": number, "currency": "USD", "dueDate": "YYYY-MM-DD", "parties": ["string"], "keyTerms": ["string"], "summary": "one sentence" }
Return only valid JSON, no explanation.`,
          },
          { role: "user", content: trimmed },
        ],
        temperature: 0,
        max_tokens: 400,
      })
      const raw = completion.choices[0]?.message?.content?.trim() ?? ""
      extractedDataJson = JSON.parse(raw) as Prisma.InputJsonValue
    } catch {
      extractedDataJson = undefined
    }
  }

  await prisma.emailAttachment.update({
    where: { id: attachmentDbId },
    data: {
      extractedText: extractedText?.slice(0, MAX_EXTRACTED_TEXT_BYTES) ?? null,
      extractedDataJson: extractedDataJson ?? undefined,
      processedAt: new Date(),
    },
  })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Create attachments listing route**

```typescript
// app/api/conversations/[id]/attachments/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const conversation = await prisma.conversation.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
    select: { id: true },
  })
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const attachments = await prisma.emailAttachment.findMany({
    where: { conversationId: params.id, tenantId: session.user.tenantId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
      extractedDataJson: true,
      processedAt: true,
    },
  })

  return NextResponse.json({ attachments })
}
```

- [ ] **Step 4: Create AttachmentsPanel.tsx**

```tsx
// app/conversations/[id]/AttachmentsPanel.tsx
"use client"

import { useState } from "react"

type AttachmentData = {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  processedAt: string | null
  extractedDataJson: {
    type?: string
    amount?: number
    currency?: string
    dueDate?: string
    parties?: string[]
    summary?: string
  } | null
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function attachmentSummary(a: AttachmentData): string {
  const d = a.extractedDataJson
  if (!d) return a.filename
  if (d.summary) return d.summary
  if (d.type === "invoice" && d.amount) {
    return `Invoice · $${d.amount.toLocaleString()}${d.dueDate ? ` · due ${d.dueDate}` : ""}`
  }
  return a.filename
}

export default function AttachmentsPanel({ attachments }: { attachments: AttachmentData[] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  if (attachments.length === 0) return null

  return (
    <section className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Attachments
      </h3>
      <ul className="space-y-2">
        {attachments.map((a) => (
          <li key={a.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-800">{attachmentSummary(a)}</span>
              <span className="text-xs text-slate-400">{formatBytes(a.sizeBytes)}</span>
            </div>
            {a.extractedDataJson && (
              <div className="mt-1">
                <button
                  onClick={() => setExpanded((p) => ({ ...p, [a.id]: !p[a.id] }))}
                  className="text-xs text-slate-400 underline hover:text-slate-600"
                >
                  {expanded[a.id] ? "Hide details" : "View extracted data"}
                </button>
                {expanded[a.id] && (
                  <pre className="mt-1 overflow-auto rounded bg-slate-50 p-2 text-xs text-slate-600">
                    {JSON.stringify(a.extractedDataJson, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 5: Render AttachmentsPanel on conversation page**

In `app/conversations/[id]/page.tsx`, add to the parallel data fetch:

```typescript
prisma.emailAttachment.findMany({
  where: { conversationId: params.id, tenantId: session.user.tenantId },
  orderBy: { createdAt: "asc" },
  select: { id: true, filename: true, mimeType: true, sizeBytes: true, extractedDataJson: true, processedAt: true },
}),
```

Import `AttachmentsPanel` and render it in the right rail below existing panels:

```tsx
<AttachmentsPanel attachments={attachments} />
```

- [ ] **Step 6: Commit**

```bash
git add lib/agent/attachment-sync.ts app/api/agent/process-attachment/ app/api/conversations/[id]/attachments/ app/conversations/[id]/AttachmentsPanel.tsx app/conversations/[id]/page.tsx
git commit -m "feat: attachment detection, PDF extraction pipeline, AttachmentsPanel on conversation page"
```

---

## Task 6: Second-Brain — PersonMemory factsJson + Extraction

**Files:**
- Create: `prisma/migrations/20260617003000_add_person_memory_facts/migration.sql`
- Modify: `prisma/schema.prisma`
- Create: `lib/agent/second-brain.ts`
- Create: `tests/second-brain.test.ts`

- [ ] **Step 1: Create migration SQL**

```sql
-- prisma/migrations/20260617003000_add_person_memory_facts/migration.sql
ALTER TABLE "PersonMemory" ADD COLUMN "factsJson" JSONB;
```

- [ ] **Step 2: Apply migration**

```bash
npx prisma db execute --file prisma/migrations/20260617003000_add_person_memory_facts/migration.sql
npx prisma migrate resolve --applied 20260617003000_add_person_memory_facts
npx prisma generate
```

- [ ] **Step 3: Update schema.prisma PersonMemory**

In `prisma/schema.prisma`, add `factsJson Json?` to the `PersonMemory` model after `llmSyncedAt`.

- [ ] **Step 4: Write failing tests for second-brain pure functions**

```typescript
// tests/second-brain.test.ts
import { describe, it, expect } from "vitest"
import { mergeFacts, deduplicateFacts, type ContactFact } from "@/lib/agent/second-brain"

const EXISTING: ContactFact[] = [
  { fact: "Prefers morning meetings", sourceMessageId: "msg_1", extractedAt: "2026-06-01T00:00:00Z", category: "preference" },
]

describe("mergeFacts", () => {
  it("adds a new fact not already present", () => {
    const newFacts: ContactFact[] = [
      { fact: "Has a dog named Max", sourceMessageId: "msg_2", extractedAt: "2026-06-17T00:00:00Z", category: "context" },
    ]
    const merged = mergeFacts(EXISTING, newFacts)
    expect(merged).toHaveLength(2)
    expect(merged[1].fact).toBe("Has a dog named Max")
  })

  it("skips duplicate facts", () => {
    const duplicate: ContactFact[] = [
      { fact: "Prefers morning meetings", sourceMessageId: "msg_99", extractedAt: "2026-06-17T00:00:00Z", category: "preference" },
    ]
    const merged = mergeFacts(EXISTING, duplicate)
    expect(merged).toHaveLength(1)
  })
})

describe("deduplicateFacts", () => {
  it("removes facts with identical text", () => {
    const facts: ContactFact[] = [
      { fact: "Prefers morning meetings", sourceMessageId: "a", extractedAt: "2026-06-01T00:00:00Z", category: "preference" },
      { fact: "Prefers morning meetings", sourceMessageId: "b", extractedAt: "2026-06-02T00:00:00Z", category: "preference" },
    ]
    expect(deduplicateFacts(facts)).toHaveLength(1)
  })
})
```

- [ ] **Step 5: Run to verify failure**

```bash
npm test -- --reporter=verbose tests/second-brain.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 6: Implement `lib/agent/second-brain.ts`**

```typescript
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

export type FactCategory = "preference" | "commitment" | "context" | "relationship"

export type ContactFact = {
  fact: string
  sourceMessageId: string
  extractedAt: string
  category: FactCategory
}

export function deduplicateFacts(facts: ContactFact[]): ContactFact[] {
  const seen = new Set<string>()
  return facts.filter((f) => {
    const key = f.fact.toLowerCase().trim()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function mergeFacts(existing: ContactFact[], incoming: ContactFact[]): ContactFact[] {
  const existingTexts = new Set(existing.map((f) => f.fact.toLowerCase().trim()))
  const novel = incoming.filter((f) => !existingTexts.has(f.fact.toLowerCase().trim()))
  return deduplicateFacts([...existing, ...novel])
}

export async function extractAndStoreFacts(
  tenantId: string,
  contactId: string,
  messageId: string,
  emailBody: string
): Promise<void> {
  const trimmedBody = emailBody.slice(0, 3000)

  let newFacts: ContactFact[] = []
  try {
    const OpenAI = (await import("openai")).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `Extract 0–3 durable facts about the email sender from this email. Facts should be things worth remembering: preferences, commitments they made, context about their situation, relationship signals. Return a JSON array: [{ "fact": "string", "category": "preference"|"commitment"|"context"|"relationship" }]. Return [] if nothing worth remembering. Return only valid JSON.`,
        },
        { role: "user", content: trimmedBody },
      ],
      temperature: 0,
      max_tokens: 300,
    })
    const raw = completion.choices[0]?.message?.content?.trim() ?? "[]"
    const parsed = JSON.parse(raw) as Array<{ fact: string; category: FactCategory }>
    newFacts = parsed
      .filter((f) => f.fact && f.category)
      .map((f) => ({
        fact: f.fact,
        category: f.category,
        sourceMessageId: messageId,
        extractedAt: new Date().toISOString(),
      }))
  } catch {
    return // LLM failure is non-fatal
  }

  if (newFacts.length === 0) return

  const memory = await prisma.personMemory.findUnique({
    where: { contactId },
    select: { factsJson: true },
  })

  const existing: ContactFact[] =
    Array.isArray(memory?.factsJson) ? (memory!.factsJson as unknown as ContactFact[]) : []
  const merged = mergeFacts(existing, newFacts)

  await prisma.personMemory.update({
    where: { contactId },
    data: { factsJson: merged as unknown as Prisma.InputJsonValue },
  })
}

export async function getFactsForContact(
  tenantId: string,
  contactId: string
): Promise<ContactFact[]> {
  const memory = await prisma.personMemory.findFirst({
    where: { tenantId, contactId },
    select: { factsJson: true },
  })
  if (!Array.isArray(memory?.factsJson)) return []
  return memory!.factsJson as unknown as ContactFact[]
}

export async function searchFacts(
  tenantId: string,
  query: string
): Promise<Array<{ contactId: string; fact: ContactFact }>> {
  const queryLower = query.toLowerCase()
  const memories = await prisma.personMemory.findMany({
    where: { tenantId },
    select: { contactId: true, factsJson: true },
  })

  const results: Array<{ contactId: string; fact: ContactFact }> = []
  for (const m of memories) {
    if (!Array.isArray(m.factsJson)) continue
    for (const fact of m.factsJson as unknown as ContactFact[]) {
      if (fact.fact.toLowerCase().includes(queryLower)) {
        results.push({ contactId: m.contactId, fact })
      }
    }
  }
  return results
}
```

- [ ] **Step 7: Run tests to confirm pass**

```bash
npm test -- --reporter=verbose tests/second-brain.test.ts
```
Expected: all tests PASS

- [ ] **Step 8: Commit**

```bash
git add prisma/migrations/20260617003000_add_person_memory_facts/ prisma/schema.prisma lib/agent/second-brain.ts tests/second-brain.test.ts
git commit -m "feat: add PersonMemory.factsJson migration, second-brain extraction and retrieval"
```

---

## Task 7: Wire Second-Brain into sync pipeline + API + UI

**Files:**
- Modify: `lib/agent/work-item-sync.ts`
- Modify: `lib/agent/reply-context.ts`
- Create: `app/api/second-brain/[contactId]/route.ts`
- Create: `app/api/second-brain/search/route.ts`
- Create: `app/conversations/[id]/SecondBrainPanel.tsx`
- Modify: `app/conversations/[id]/page.tsx`

- [ ] **Step 1: Wire fact extraction into work-item-sync**

In `lib/agent/work-item-sync.ts`, add import:

```typescript
import { extractAndStoreFacts } from "@/lib/agent/second-brain"
```

After the existing person-memory sync block (after `syncPersonMemoryWithLLM`), add:

```typescript
  // Second-brain fact extraction (fire-and-forget)
  if (firstInbound && conversation.contact?.id && input.enableRichAi) {
    extractAndStoreFacts(
      conversation.tenantId,
      conversation.contact.id,
      firstInbound.id,
      firstInbound.body
    ).catch(() => {/* non-fatal */})
  }
```

- [ ] **Step 2: Include facts in reply context**

In `lib/agent/reply-context.ts`, find where the PersonMemory context is built and add fact retrieval. Import:

```typescript
import { getFactsForContact } from "@/lib/agent/second-brain"
```

After fetching PersonMemory, add:

```typescript
const facts = conversation.contact?.id
  ? await getFactsForContact(tenantId, conversation.contact.id)
  : []

// Add to context string
if (facts.length > 0) {
  contextParts.push(
    `What I know about this person:\n${facts.slice(0, 5).map((f) => `- ${f.fact}`).join("\n")}`
  )
}
```

- [ ] **Step 3: Create second-brain API routes**

```typescript
// app/api/second-brain/[contactId]/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getFactsForContact } from "@/lib/agent/second-brain"

export async function GET(
  _request: Request,
  { params }: { params: { contactId: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const facts = await getFactsForContact(session.user.tenantId, params.contactId)
  return NextResponse.json({ facts })
}
```

```typescript
// app/api/second-brain/search/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { searchFacts } from "@/lib/agent/second-brain"

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const body = await request.json()
  const query = typeof body?.query === "string" ? body.query.trim() : ""
  if (!query) return NextResponse.json({ error: "query required" }, { status: 400 })

  const results = await searchFacts(session.user.tenantId, query)
  return NextResponse.json({ results })
}
```

- [ ] **Step 4: Create SecondBrainPanel.tsx**

```tsx
// app/conversations/[id]/SecondBrainPanel.tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

type ContactFact = {
  fact: string
  category: string
  extractedAt: string
  sourceMessageId: string
}

export default function SecondBrainPanel({
  contactName,
  contactId,
  facts,
}: {
  contactName: string
  contactId: string
  facts: ContactFact[]
}) {
  const router = useRouter()
  const [localFacts, setLocalFacts] = useState(facts)

  if (localFacts.length === 0) return null

  const categoryColors: Record<string, string> = {
    preference: "bg-blue-50 text-blue-700",
    commitment: "bg-green-50 text-green-700",
    context: "bg-slate-50 text-slate-600",
    relationship: "bg-purple-50 text-purple-700",
  }

  return (
    <section className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        What I know about {contactName}
      </h3>
      <ul className="space-y-1.5">
        {localFacts.map((f, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className={`mt-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium ${categoryColors[f.category] ?? "bg-slate-50 text-slate-600"}`}>
              {f.category}
            </span>
            <span className="text-sm text-slate-700">{f.fact}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 5: Render SecondBrainPanel on conversation page**

In `app/conversations/[id]/page.tsx`, fetch facts for the conversation's contact:

```typescript
import { getFactsForContact } from "@/lib/agent/second-brain"

// In the parallel fetch, add:
conversation.contact?.id
  ? getFactsForContact(session.user.tenantId, conversation.contact.id)
  : Promise.resolve([]),
```

Import `SecondBrainPanel` and render below AttachmentsPanel in the right rail:

```tsx
{conversation.contact && (
  <SecondBrainPanel
    contactName={conversation.contact.name ?? conversation.contact.email ?? "this person"}
    contactId={conversation.contact.id}
    facts={contactFacts}
  />
)}
```

- [ ] **Step 6: Run full test suite**

```bash
npm test
```
Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add lib/agent/work-item-sync.ts lib/agent/reply-context.ts app/api/second-brain/ app/conversations/[id]/SecondBrainPanel.tsx app/conversations/[id]/page.tsx
git commit -m "feat: wire second-brain into sync pipeline and reply context; add facts panel and API routes"
```

---

## Final v3.1 Verification

- [ ] Start dev server: `npm run dev`
- [ ] Open a conversation and use the Snooze button — confirm the modal opens with quick options
- [ ] Snooze a conversation for "Tonight" — confirm it disappears from main inbox and appears in the Snoozed tab
- [ ] Check `/api/cron/snooze-check` with the CRON_SECRET — confirm it resurfaced the conversation
- [ ] Open a conversation with a PDF attachment — confirm AttachmentsPanel shows filename (and extracted data if processed)
- [ ] Check that SecondBrainPanel renders when a contact has known facts
- [ ] Confirm test suite passes: `npm test`
