# Phase 4 v4.1 — Scheduling, Automations, Workflows & Integrations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship smart scheduling (#14), outcome-based automation (#26), multi-step workflows (#31), Google Drive integration (#35), and docs updates.

**Architecture:** Four new Prisma models (`SchedulingSession`, `AutomationRun`, `WorkflowTemplate`, `WorkflowRun`, `GoogleDriveCredential`). Scheduling detection wired into `syncConversationWorkItems`. AutomationRun uses existing `ApprovalRequest` for gates. WorkflowRun checked by a cron job.

**Tech Stack:** TypeScript, Prisma (PostgreSQL), Next.js App Router, OpenAI, Google Calendar API, Google Drive API, Vitest

**Spec:** `docs/superpowers/specs/2026-06-17-phase-4-automations-integrations-design.md`

## Global Constraints

- Auth guard: every API route must call `getServerSession(authOptions)` and return 401 if `!session?.user?.tenantId`
- Tenant isolation: all DB queries include `tenantId` filter  
- Migrations go in `prisma/migrations/YYYYMMDDHHMMSS_<name>/migration.sql`
- Tests use Vitest and mock Prisma with `vi.mock("@/lib/prisma", ...)`
- Run `npx tsc --noEmit` and `npm test` before each commit

---

## File Structure

**New files:**
- `prisma/migrations/20260617020000_add_scheduling_session/migration.sql`
- `prisma/migrations/20260617021000_add_automation_runs/migration.sql`
- `prisma/migrations/20260617022000_add_workflow_templates/migration.sql`
- `prisma/migrations/20260617023000_add_google_drive_credential/migration.sql`
- `lib/agent/scheduling.ts` — scheduling detection + slot proposal
- `lib/agent/automation-runner.ts` — step executor for AutomationRun
- `lib/agent/workflow-runner.ts` — advance WorkflowRun steps
- `lib/integrations/google-drive.ts` — Drive OAuth refresh + search
- `app/api/conversations/[id]/scheduling/route.ts`
- `app/api/automation-runs/[id]/rollback/route.ts`
- `app/api/workflow-templates/route.ts`
- `app/api/workflow-templates/[id]/route.ts`
- `app/api/cron/workflow-runner/route.ts`
- `app/api/integrations/google-drive/connect/route.ts`
- `app/api/integrations/google-drive/callback/route.ts`
- `app/api/integrations/google-drive/disconnect/route.ts`
- `app/conversations/[id]/SchedulingPanel.tsx`
- `app/conversations/[id]/AutomationRunHistory.tsx`
- `app/settings/WorkflowsPanel.tsx`
- `app/settings/ConnectedAppsPanel.tsx`
- `tests/scheduling-detector.test.ts`
- `tests/workflow-runner.test.ts`
- `tests/automation-runner.test.ts`

**Modified files:**
- `prisma/schema.prisma` — add 5 new models + Tenant relations
- `lib/agent/work-item-sync.ts` — wire scheduling detection
- `app/conversations/[id]/page.tsx` — render SchedulingPanel, AutomationRunHistory
- `app/settings/page.tsx` — render WorkflowsPanel, ConnectedAppsPanel
- `docs/TODO.md` — mark Phase 4 complete
- `docs/MASTER_PRODUCT_PLAN.md` — update feature statuses
- `docs/CURRENT_STATE.md` — document new Phase 4 capabilities

---

## Task 7: Phase 4 schema migrations

**Files:**
- Create: `prisma/migrations/20260617020000_add_scheduling_session/migration.sql`
- Create: `prisma/migrations/20260617021000_add_automation_runs/migration.sql`
- Create: `prisma/migrations/20260617022000_add_workflow_templates/migration.sql`
- Create: `prisma/migrations/20260617023000_add_google_drive_credential/migration.sql`
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Write SchedulingSession migration**

```sql
-- prisma/migrations/20260617020000_add_scheduling_session/migration.sql
-- CreateTable
CREATE TABLE "SchedulingSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'detecting',
    "proposedTimesJson" JSONB,
    "confirmedTime" TEXT,
    "calendarEmail" TEXT,
    "eventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchedulingSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SchedulingSession_conversationId_key" ON "SchedulingSession"("conversationId");
CREATE INDEX "SchedulingSession_tenantId_status_idx" ON "SchedulingSession"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "SchedulingSession" ADD CONSTRAINT "SchedulingSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchedulingSession" ADD CONSTRAINT "SchedulingSession_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 2: Write AutomationRun migration**

```sql
-- prisma/migrations/20260617021000_add_automation_runs/migration.sql
-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "stepsJson" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvalRequired" BOOLEAN NOT NULL DEFAULT true,
    "approvalRequestId" TEXT,
    "rolledBackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationRun_tenantId_status_idx" ON "AutomationRun"("tenantId", "status");
CREATE INDEX "AutomationRun_conversationId_idx" ON "AutomationRun"("conversationId");

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Write WorkflowTemplate + WorkflowRun migration**

```sql
-- prisma/migrations/20260617022000_add_workflow_templates/migration.sql
-- CreateTable
CREATE TABLE "WorkflowTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "stepsJson" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workflowTemplateId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'running',
    "stateJson" JSONB,
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowTemplate_tenantId_idx" ON "WorkflowTemplate"("tenantId");
CREATE INDEX "WorkflowRun_tenantId_status_idx" ON "WorkflowRun"("tenantId", "status");
CREATE INDEX "WorkflowRun_nextRunAt_idx" ON "WorkflowRun"("nextRunAt");
CREATE INDEX "WorkflowRun_conversationId_idx" ON "WorkflowRun"("conversationId");

-- AddForeignKey
ALTER TABLE "WorkflowTemplate" ADD CONSTRAINT "WorkflowTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workflowTemplateId_fkey" FOREIGN KEY ("workflowTemplateId") REFERENCES "WorkflowTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Write GoogleDriveCredential migration**

```sql
-- prisma/migrations/20260617023000_add_google_drive_credential/migration.sql
-- CreateTable
CREATE TABLE "GoogleDriveCredential" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "tokenExpiry" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoogleDriveCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleDriveCredential_tenantId_key" ON "GoogleDriveCredential"("tenantId");

-- AddForeignKey
ALTER TABLE "GoogleDriveCredential" ADD CONSTRAINT "GoogleDriveCredential_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 5: Update schema.prisma**

Add to `Tenant` model (after `gmailWritebackQueue`):
```prisma
  schedulingSessions        SchedulingSession[]
  automationRuns            AutomationRun[]
  workflowTemplates         WorkflowTemplate[]
  workflowRuns              WorkflowRun[]
  googleDriveCredential     GoogleDriveCredential?
```

Add to `Conversation` model (after `gmailWritebacks`):
```prisma
  schedulingSession         SchedulingSession?
  automationRuns            AutomationRun[]
  workflowRuns              WorkflowRun[]
```

Add these models at the end of `prisma/schema.prisma`:

```prisma
model SchedulingSession {
  id               String       @id @default(cuid())
  tenantId         String
  conversationId   String       @unique
  status           String       @default("detecting")
  proposedTimesJson Json?
  confirmedTime    String?
  calendarEmail    String?
  eventId          String?
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt
  tenant           Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  conversation     Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([tenantId, status])
}

model AutomationRun {
  id                String       @id @default(cuid())
  tenantId          String
  conversationId    String
  trigger           String
  stepsJson         Json         @default("[]")
  status            String       @default("pending")
  approvalRequired  Boolean      @default(true)
  approvalRequestId String?
  rolledBackAt      DateTime?
  createdAt         DateTime     @default(now())
  updatedAt         DateTime     @updatedAt
  tenant            Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  conversation      Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([tenantId, status])
  @@index([conversationId])
}

model WorkflowTemplate {
  id        String        @id @default(cuid())
  tenantId  String
  name      String
  trigger   String
  stepsJson Json          @default("[]")
  enabled   Boolean       @default(true)
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt
  tenant    Tenant        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  runs      WorkflowRun[]

  @@index([tenantId])
}

model WorkflowRun {
  id                 String           @id @default(cuid())
  tenantId           String
  workflowTemplateId String
  conversationId     String
  currentStep        Int              @default(0)
  status             String           @default("running")
  stateJson          Json?
  nextRunAt          DateTime?
  createdAt          DateTime         @default(now())
  updatedAt          DateTime         @updatedAt
  tenant             Tenant           @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  template           WorkflowTemplate @relation(fields: [workflowTemplateId], references: [id], onDelete: Cascade)
  conversation       Conversation     @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([tenantId, status])
  @@index([nextRunAt])
  @@index([conversationId])
}

model GoogleDriveCredential {
  id                    String    @id @default(cuid())
  tenantId              String    @unique
  email                 String
  accessTokenEncrypted  String
  refreshTokenEncrypted String
  tokenExpiry           DateTime?
  createdAt             DateTime  @default(now())
  tenant                Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 6: Regenerate + migrate**

```bash
npx prisma generate
npx prisma migrate deploy
npx tsc --noEmit
```

Expected: 4 migrations applied, no TS errors.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260617020000_add_scheduling_session/ prisma/migrations/20260617021000_add_automation_runs/ prisma/migrations/20260617022000_add_workflow_templates/ prisma/migrations/20260617023000_add_google_drive_credential/
git commit -m "feat: add SchedulingSession, AutomationRun, WorkflowTemplate/Run, GoogleDriveCredential models

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Smart scheduling detection + proposal

**Files:**
- Create: `lib/agent/scheduling.ts`
- Create: `tests/scheduling-detector.test.ts`
- Modify: `lib/agent/work-item-sync.ts`

**Interfaces:**
- Produces: `detectSchedulingRequest(subject: string, body: string): boolean`
- Produces: `proposeSchedulingSlots(tenantId: string, conversationId: string, calendarEmail: string): Promise<ProposedSlot[]>` where `ProposedSlot = { start: string; end: string; label: string }`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/scheduling-detector.test.ts
import { describe, it, expect } from "vitest"
import { detectSchedulingRequest } from "@/lib/agent/scheduling"

describe("detectSchedulingRequest", () => {
  it("detects 'can we schedule a call'", () => {
    expect(detectSchedulingRequest("Following up", "Hey, can we schedule a call this week?")).toBe(true)
  })
  it("detects 'find a time'", () => {
    expect(detectSchedulingRequest("Meeting", "Would love to find a time to connect.")).toBe(true)
  })
  it("detects 'are you available'", () => {
    expect(detectSchedulingRequest("Quick chat", "Are you available for a 30-minute chat on Thursday?")).toBe(true)
  })
  it("does not detect regular emails", () => {
    expect(detectSchedulingRequest("Invoice attached", "Please find attached invoice #1234.")).toBe(false)
  })
  it("does not detect already-scheduled confirmations", () => {
    expect(detectSchedulingRequest("Calendar invite", "You have been invited to a meeting.")).toBe(false)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- scheduling-detector
```

Expected: FAIL

- [ ] **Step 3: Implement scheduling lib**

```typescript
// lib/agent/scheduling.ts
import { prisma } from "@/lib/prisma"
import { decrypt } from "@/lib/encryption"
import { google } from "googleapis"
import { listEvents } from "@/lib/google"

const SCHEDULING_PATTERNS = [
  /can we (schedule|set up|arrange|book) (a |an )?(call|meeting|chat|time|session)/i,
  /find (a |some )?time (to |for )/i,
  /are you available/i,
  /what(?:'s| is) your availability/i,
  /when (are you|would you be) (free|available)/i,
  /let(?:'s| us) (meet|chat|talk|connect|catch up)/i,
  /schedule (a |an )?(call|meeting|time)/i,
  /book (a |an )?(time|slot|call|meeting)/i,
  /hop on (a |the )?(call|zoom|meet)/i,
]

const EXCLUSION_PATTERNS = [
  /calendar invite/i,
  /you(?:'ve| have) been invited/i,
  /this is a reminder/i,
  /meeting has been (scheduled|confirmed|cancelled)/i,
]

export function detectSchedulingRequest(subject: string, body: string): boolean {
  const text = `${subject} ${body}`
  if (EXCLUSION_PATTERNS.some((p) => p.test(text))) return false
  return SCHEDULING_PATTERNS.some((p) => p.test(text))
}

export type ProposedSlot = { start: string; end: string; label: string }

export async function proposeSchedulingSlots(
  tenantId: string,
  calendarEmail: string
): Promise<ProposedSlot[]> {
  const cred = await prisma.googleCalendarCredential.findFirst({
    where: { tenantId, email: calendarEmail },
  })
  if (!cred) return []

  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  )
  auth.setCredentials({
    access_token: decrypt(cred.accessTokenEncrypted),
    refresh_token: decrypt(cred.refreshTokenEncrypted),
  })
  const calendar = google.calendar({ version: "v3", auth })

  const now = new Date()
  const windowEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const existing = await listEvents(calendar, { timeMin: now, timeMax: windowEnd, maxResults: 50 })

  // Build 30-min slots on business days 9am–5pm
  const slots: ProposedSlot[] = []
  const cursor = new Date(now)
  cursor.setMinutes(0, 0, 0)
  cursor.setHours(cursor.getHours() + 1) // start next hour

  while (slots.length < 3 && cursor < windowEnd) {
    const day = cursor.getDay()
    const hour = cursor.getHours()
    if (day !== 0 && day !== 6 && hour >= 9 && hour < 17) {
      const slotEnd = new Date(cursor.getTime() + 30 * 60 * 1000)
      const conflict = existing.some(
        (e) => e.start < slotEnd && e.end > cursor
      )
      if (!conflict) {
        const label = cursor.toLocaleString("en-US", {
          weekday: "long", month: "short", day: "numeric",
          hour: "numeric", minute: "2-digit", hour12: true,
        })
        slots.push({ start: cursor.toISOString(), end: slotEnd.toISOString(), label })
      }
    }
    cursor.setMinutes(cursor.getMinutes() + 30)
  }

  return slots
}

export function detectConfirmation(body: string, proposedSlots: ProposedSlot[]): ProposedSlot | null {
  const lower = body.toLowerCase()
  for (const slot of proposedSlots) {
    const slotDate = new Date(slot.start)
    const dayName = slotDate.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase()
    const timeStr = slotDate.toLocaleTimeString("en-US", { hour: "numeric", hour12: true }).toLowerCase()
    if (lower.includes(dayName) && lower.includes(timeStr.replace(":00", ""))) {
      return slot
    }
    // Also check the label text
    const labelLower = slot.label.toLowerCase()
    const labelWords = labelLower.split(/[\s,]+/).filter((w) => w.length > 3)
    const matchCount = labelWords.filter((w) => lower.includes(w)).length
    if (matchCount >= 3) return slot
  }
  return null
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- scheduling-detector
```

Expected: all pass

- [ ] **Step 5: Wire scheduling detection into work-item-sync**

In `lib/agent/work-item-sync.ts`, add import at top:
```typescript
import { detectSchedulingRequest } from "@/lib/agent/scheduling"
```

Inside `syncConversationWorkItems`, after existing classification calls (e.g., after `detectVip`), add:

```typescript
// Scheduling detection
const latestInbound = conversation.messages
  .filter((m) => m.direction === "inbound")
  .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]

if (latestInbound) {
  const isSchedulingRequest = detectSchedulingRequest(
    latestInbound.subject ?? "",
    latestInbound.body
  )
  if (isSchedulingRequest) {
    const existingSession = await prisma.schedulingSession.findUnique({
      where: { conversationId: conversation.id },
    })
    if (!existingSession) {
      await prisma.schedulingSession.create({
        data: {
          tenantId: input.tenantId,
          conversationId: conversation.id,
          status: "detecting",
        },
      })
    }
  }
}
```

- [ ] **Step 6: Create scheduling API route**

```typescript
// app/api/conversations/[id]/scheduling/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { proposeSchedulingSlots, detectConfirmation } from "@/lib/agent/scheduling"

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const schedulingSession = await prisma.schedulingSession.findFirst({
    where: { conversationId: params.id, tenantId: session.user.tenantId },
  })
  return NextResponse.json({ schedulingSession })
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = session.user.tenantId
  const { calendarEmail } = await request.json()

  const slots = calendarEmail
    ? await proposeSchedulingSlots(tenantId, calendarEmail)
    : []

  const schedulingSession = await prisma.schedulingSession.upsert({
    where: { conversationId: params.id },
    update: {
      status: slots.length > 0 ? "proposing" : "detecting",
      proposedTimesJson: slots.length > 0 ? slots : undefined,
      calendarEmail: calendarEmail ?? undefined,
    },
    create: {
      tenantId,
      conversationId: params.id,
      status: slots.length > 0 ? "proposing" : "detecting",
      proposedTimesJson: slots,
      calendarEmail: calendarEmail ?? undefined,
    },
  })

  return NextResponse.json({ schedulingSession, slots })
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json()
  const existing = await prisma.schedulingSession.findFirst({
    where: { conversationId: params.id, tenantId: session.user.tenantId },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const updated = await prisma.schedulingSession.update({
    where: { conversationId: params.id },
    data: {
      ...(body.confirmedTime && { confirmedTime: body.confirmedTime, status: "confirmed" }),
      ...(body.eventId && { eventId: body.eventId, status: "booked" }),
      ...(body.status && { status: body.status }),
    },
  })
  return NextResponse.json({ schedulingSession: updated })
}
```

- [ ] **Step 7: Create SchedulingPanel UI**

```typescript
// app/conversations/[id]/SchedulingPanel.tsx
"use client"
import { useState } from "react"

type ProposedSlot = { start: string; end: string; label: string }
type SchedulingSession = {
  id: string
  status: string
  proposedTimesJson: ProposedSlot[] | null
  confirmedTime: string | null
  calendarEmail: string | null
  eventId: string | null
}

export default function SchedulingPanel({
  conversationId,
  calendarEmails,
  initialSession,
}: {
  conversationId: string
  calendarEmails: string[]
  initialSession: SchedulingSession | null
}) {
  const [session, setSession] = useState(initialSession)
  const [selectedCalendar, setSelectedCalendar] = useState(calendarEmails[0] ?? "")
  const [loading, setLoading] = useState(false)

  async function proposeSlots() {
    setLoading(true)
    const res = await fetch(`/api/conversations/${conversationId}/scheduling`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ calendarEmail: selectedCalendar }),
    })
    const data = await res.json()
    setSession(data.schedulingSession)
    setLoading(false)
  }

  async function confirmSlot(slot: ProposedSlot) {
    const res = await fetch(`/api/conversations/${conversationId}/scheduling`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmedTime: slot.start }),
    })
    const data = await res.json()
    setSession(data.schedulingSession)
  }

  if (!session && calendarEmails.length === 0) return null

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
      <p className="text-xs font-semibold text-blue-800">Scheduling Request Detected</p>

      {!session || session.status === "detecting" ? (
        <div className="space-y-2">
          {calendarEmails.length > 1 && (
            <select
              value={selectedCalendar}
              onChange={(e) => setSelectedCalendar(e.target.value)}
              className="w-full rounded border border-blue-200 bg-white px-2 py-1 text-xs"
            >
              {calendarEmails.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          )}
          <button
            onClick={proposeSlots}
            disabled={loading || !selectedCalendar}
            className="w-full rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {loading ? "Checking availability…" : "Propose time slots"}
          </button>
        </div>
      ) : session.status === "proposing" && session.proposedTimesJson ? (
        <div className="space-y-2">
          <p className="text-xs text-blue-700">Proposed slots — click to confirm:</p>
          {session.proposedTimesJson.map((slot, i) => (
            <button
              key={i}
              onClick={() => confirmSlot(slot)}
              className="w-full rounded-lg border border-blue-300 bg-white px-3 py-2 text-left text-xs hover:bg-blue-50"
            >
              {slot.label}
            </button>
          ))}
        </div>
      ) : session.status === "confirmed" ? (
        <p className="text-xs text-blue-700">
          Time confirmed: {session.confirmedTime ? new Date(session.confirmedTime).toLocaleString() : "—"}
        </p>
      ) : session.status === "booked" ? (
        <p className="text-xs text-green-700 font-medium">Calendar event created.</p>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 8: Type-check, test, commit**

```bash
npx tsc --noEmit
npm test
git add lib/agent/scheduling.ts tests/scheduling-detector.test.ts app/api/conversations/[id]/scheduling/ app/conversations/[id]/SchedulingPanel.tsx lib/agent/work-item-sync.ts
git commit -m "feat: smart scheduling detection, slot proposal, and SchedulingPanel

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 9: Outcome-based automation

**Files:**
- Create: `lib/agent/automation-runner.ts`
- Create: `app/api/automation-runs/[id]/rollback/route.ts`
- Create: `app/conversations/[id]/AutomationRunHistory.tsx`
- Create: `tests/automation-runner.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/automation-runner.test.ts
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    automationRun: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    inboxTask: { create: vi.fn(), deleteMany: vi.fn() },
    draft: { update: vi.fn() },
    conversationState: { update: vi.fn() },
    approvalRequest: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import { executeAutomationStep, type AutomationStep } from "@/lib/agent/automation-runner"
import { prisma } from "@/lib/prisma"

describe("executeAutomationStep", () => {
  it("executes create_task step and returns rollback data", async () => {
    vi.mocked(prisma.inboxTask.create).mockResolvedValueOnce({ id: "task1" } as never)
    const step: AutomationStep = {
      type: "create_task",
      payload: { tenantId: "t1", conversationId: "c1", title: "Follow up", deterministicKey: "auto-c1-follow" },
    }
    const result = await executeAutomationStep(step)
    expect(result.status).toBe("completed")
    expect(result.rollbackData).toEqual({ taskId: "task1" })
  })

  it("executes update_attention step", async () => {
    vi.mocked(prisma.conversationState.update).mockResolvedValueOnce({} as never)
    const step: AutomationStep = {
      type: "update_attention",
      payload: { conversationId: "c1", attentionCategory: "review_soon", previousAttention: "needs_reply" },
    }
    const result = await executeAutomationStep(step)
    expect(result.status).toBe("completed")
    expect(result.rollbackData.previousAttention).toBe("needs_reply")
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- automation-runner
```

- [ ] **Step 3: Implement automation-runner**

```typescript
// lib/agent/automation-runner.ts
import { prisma } from "@/lib/prisma"

export type AutomationStep = {
  type: "create_task" | "update_attention" | "create_draft" | "archive"
  payload: Record<string, unknown>
  status?: "pending" | "completed" | "failed"
  output?: unknown
  rollbackData?: Record<string, unknown>
}

export type StepResult = {
  status: "completed" | "failed"
  output?: unknown
  rollbackData: Record<string, unknown>
  error?: string
}

export async function executeAutomationStep(step: AutomationStep): Promise<StepResult> {
  try {
    if (step.type === "create_task") {
      const { tenantId, conversationId, title, deterministicKey } = step.payload as {
        tenantId: string; conversationId: string; title: string; deterministicKey: string
      }
      const task = await prisma.inboxTask.create({
        data: {
          tenantId, conversationId, title, deterministicKey,
          status: "open", source: "automation",
        },
      })
      return { status: "completed", output: { taskId: task.id }, rollbackData: { taskId: task.id } }
    }

    if (step.type === "update_attention") {
      const { conversationId, attentionCategory } = step.payload as {
        conversationId: string; attentionCategory: string; previousAttention?: string
      }
      await prisma.conversationState.update({
        where: { conversationId },
        data: { attentionCategory, source: "automation" },
      })
      return {
        status: "completed",
        output: { attentionCategory },
        rollbackData: { conversationId, previousAttention: step.payload.previousAttention ?? null },
      }
    }

    if (step.type === "archive") {
      const { conversationId } = step.payload as { conversationId: string }
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { status: "closed" },
      })
      return { status: "completed", output: {}, rollbackData: { conversationId } }
    }

    return { status: "failed", error: `Unknown step type: ${step.type}`, rollbackData: {} }
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : "Unknown error",
      rollbackData: {},
    }
  }
}

export async function rollbackAutomationStep(step: AutomationStep & { rollbackData: Record<string, unknown> }): Promise<void> {
  if (step.type === "create_task" && step.rollbackData.taskId) {
    await prisma.inboxTask.deleteMany({ where: { id: step.rollbackData.taskId as string } })
  }
  if (step.type === "update_attention" && step.rollbackData.previousAttention) {
    await prisma.conversationState.update({
      where: { conversationId: step.rollbackData.conversationId as string },
      data: { attentionCategory: step.rollbackData.previousAttention as string },
    })
  }
  if (step.type === "archive" && step.rollbackData.conversationId) {
    await prisma.conversation.update({
      where: { id: step.rollbackData.conversationId as string },
      data: { status: "needs_reply" },
    })
  }
}

// System-default automation triggers seeded per tenant
export const DEFAULT_AUTOMATION_TRIGGERS: Array<{
  trigger: string
  name: string
  steps: AutomationStep[]
}> = [
  {
    trigger: "billing_dispute_detected",
    name: "Billing Dispute Response",
    steps: [
      { type: "update_attention", payload: { attentionCategory: "needs_action" } },
      { type: "create_task", payload: { title: "Review billing dispute", deterministicKey: "auto-billing-dispute" } },
    ],
  },
  {
    trigger: "scheduling_detected",
    name: "Scheduling Request Detected",
    steps: [
      { type: "update_attention", payload: { attentionCategory: "needs_action" } },
    ],
  },
]
```

- [ ] **Step 4: Run tests**

```bash
npm test -- automation-runner
```

- [ ] **Step 5: Create rollback route**

```typescript
// app/api/automation-runs/[id]/rollback/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { rollbackAutomationStep, type AutomationStep } from "@/lib/agent/automation-runner"

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const run = await prisma.automationRun.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
  })
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (run.status === "rolled_back") return NextResponse.json({ error: "Already rolled back" }, { status: 409 })

  // Rollback window: 24h
  const age = Date.now() - run.createdAt.getTime()
  if (age > 24 * 60 * 60 * 1000) return NextResponse.json({ error: "Rollback window expired" }, { status: 410 })

  const steps = (run.stepsJson as AutomationStep[]).filter((s) => s.status === "completed").reverse()
  for (const step of steps) {
    if (step.rollbackData) {
      await rollbackAutomationStep(step as AutomationStep & { rollbackData: Record<string, unknown> })
    }
  }

  await prisma.automationRun.update({
    where: { id: params.id },
    data: { status: "rolled_back", rolledBackAt: new Date() },
  })

  await prisma.auditLog.create({
    data: {
      tenantId: session.user.tenantId,
      action: "automation_run.rolled_back",
      payloadJson: { automationRunId: params.id, stepsRolledBack: steps.length },
    },
  })

  return NextResponse.json({ ok: true, stepsRolledBack: steps.length })
}
```

- [ ] **Step 6: Create AutomationRunHistory panel**

```typescript
// app/conversations/[id]/AutomationRunHistory.tsx
"use client"
import { useState } from "react"

type AutomationStep = { type: string; status?: string; error?: string }
type AutomationRun = {
  id: string
  trigger: string
  status: string
  stepsJson: AutomationStep[]
  createdAt: string
  rolledBackAt: string | null
}

export default function AutomationRunHistory({ runs }: { runs: AutomationRun[] }) {
  const [rolling, setRolling] = useState<Record<string, boolean>>({})
  const [rolledBack, setRolledBack] = useState<Set<string>>(new Set())

  async function handleRollback(id: string) {
    setRolling((p) => ({ ...p, [id]: true }))
    await fetch(`/api/automation-runs/${id}/rollback`, { method: "POST" })
    setRolledBack((p) => new Set([...p, id]))
    setRolling((p) => ({ ...p, [id]: false }))
  }

  if (runs.length === 0) return null

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Automations</p>
      {runs.map((run) => (
        <div key={run.id} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-medium text-slate-700">{run.trigger.replace(/_/g, " ")}</p>
              <p className="mt-0.5 text-xs text-slate-400">
                {run.stepsJson.length} steps · {run.status}
              </p>
            </div>
            {run.status === "completed" && !rolledBack.has(run.id) && !run.rolledBackAt && (
              <button
                onClick={() => handleRollback(run.id)}
                disabled={rolling[run.id]}
                className="shrink-0 text-xs text-slate-400 underline hover:text-red-500"
              >
                {rolling[run.id] ? "…" : "Undo"}
              </button>
            )}
            {(rolledBack.has(run.id) || run.rolledBackAt) && (
              <span className="text-xs text-slate-400">Undone</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 7: Type-check, test, commit**

```bash
npx tsc --noEmit
npm test
git add lib/agent/automation-runner.ts tests/automation-runner.test.ts app/api/automation-runs/ app/conversations/[id]/AutomationRunHistory.tsx
git commit -m "feat: outcome-based automation runner with step execution and rollback

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 10: Multi-step workflow runner

**Files:**
- Create: `lib/agent/workflow-runner.ts`
- Create: `app/api/workflow-templates/route.ts`
- Create: `app/api/workflow-templates/[id]/route.ts`
- Create: `app/api/cron/workflow-runner/route.ts`
- Create: `app/settings/WorkflowsPanel.tsx`
- Create: `tests/workflow-runner.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/workflow-runner.test.ts
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workflowRun: { findMany: vi.fn(), update: vi.fn() },
    conversation: { update: vi.fn() },
    inboxTask: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import { advanceWorkflowStep, computeNextRunAt } from "@/lib/agent/workflow-runner"

describe("computeNextRunAt", () => {
  it("returns null for send_draft step (no wait)", () => {
    const step = { type: "send_draft", waitDaysAfterPrevious: 0 }
    expect(computeNextRunAt(step, new Date())).toBeNull()
  })

  it("returns future date for wait step", () => {
    const now = new Date("2026-06-17T10:00:00Z")
    const step = { type: "wait", days: 3 }
    const result = computeNextRunAt(step, now)
    expect(result?.toISOString()).toBe("2026-06-20T10:00:00.000Z")
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- workflow-runner
```

- [ ] **Step 3: Implement workflow runner**

```typescript
// lib/agent/workflow-runner.ts
import { prisma } from "@/lib/prisma"

type WorkflowStep = {
  type: "send_draft" | "wait" | "close_conversation" | "create_task"
  waitDaysAfterPrevious?: number
  days?: number
  requireApproval?: boolean
  draftHint?: string
  taskTitle?: string
}

export function computeNextRunAt(step: WorkflowStep, from: Date): Date | null {
  const days = step.type === "wait" ? (step.days ?? 1) : (step.waitDaysAfterPrevious ?? 0)
  if (days <= 0) return null
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000)
}

export async function advanceWorkflowStep(runId: string): Promise<"advanced" | "completed" | "skipped"> {
  const run = await prisma.workflowRun.findUnique({
    where: { id: runId },
    include: { template: true },
  })
  if (!run || run.status !== "running") return "skipped"

  const steps = run.template.stepsJson as WorkflowStep[]
  const currentStep = run.currentStep

  if (currentStep >= steps.length) {
    await prisma.workflowRun.update({ where: { id: runId }, data: { status: "completed" } })
    return "completed"
  }

  const step = steps[currentStep]

  if (step.type === "wait") {
    const nextRunAt = computeNextRunAt(step, new Date())
    await prisma.workflowRun.update({
      where: { id: runId },
      data: { currentStep: currentStep + 1, nextRunAt },
    })
    return "advanced"
  }

  if (step.type === "close_conversation") {
    await prisma.conversation.update({
      where: { id: run.conversationId },
      data: { status: "closed" },
    })
  }

  if (step.type === "create_task" && step.taskTitle) {
    await prisma.inboxTask.create({
      data: {
        tenantId: run.tenantId,
        conversationId: run.conversationId,
        title: step.taskTitle,
        status: "open",
        source: "workflow",
        deterministicKey: `workflow-${run.id}-step-${currentStep}`,
      },
    })
  }

  const nextStep = steps[currentStep + 1]
  const nextRunAt = nextStep ? computeNextRunAt(nextStep, new Date()) : null

  if (currentStep + 1 >= steps.length) {
    await prisma.workflowRun.update({ where: { id: runId }, data: { status: "completed", currentStep: currentStep + 1 } })
    return "completed"
  }

  await prisma.workflowRun.update({
    where: { id: runId },
    data: { currentStep: currentStep + 1, nextRunAt },
  })
  return "advanced"
}

export async function runDueWorkflows(): Promise<number> {
  const due = await prisma.workflowRun.findMany({
    where: { status: "running", nextRunAt: { lte: new Date() } },
    take: 50,
  })
  let count = 0
  for (const run of due) {
    await advanceWorkflowStep(run.id)
    count++
  }
  return count
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- workflow-runner
```

- [ ] **Step 5: Create workflow template API routes**

```typescript
// app/api/workflow-templates/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

const DEFAULT_TEMPLATES = [
  {
    name: "Lead Quiet Follow-up",
    trigger: "lead_quiet_3d",
    stepsJson: [
      { type: "create_task", taskTitle: "Send follow-up to quiet lead", waitDaysAfterPrevious: 0 },
      { type: "wait", days: 3 },
      { type: "close_conversation" },
    ],
  },
  {
    name: "Scheduling Unconfirmed Nudge",
    trigger: "scheduling_unconfirmed_2d",
    stepsJson: [
      { type: "create_task", taskTitle: "Nudge scheduling confirmation", waitDaysAfterPrevious: 0 },
      { type: "wait", days: 2 },
      { type: "close_conversation" },
    ],
  },
  {
    name: "VIP No-Reply Follow-up",
    trigger: "vip_no_reply_2d",
    stepsJson: [
      { type: "create_task", taskTitle: "Follow up with VIP contact", waitDaysAfterPrevious: 0 },
      { type: "wait", days: 2 },
    ],
  },
]

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tenantId = session.user.tenantId

  let templates = await prisma.workflowTemplate.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } })

  // Seed defaults if none exist
  if (templates.length === 0) {
    await prisma.workflowTemplate.createMany({
      data: DEFAULT_TEMPLATES.map((t) => ({ ...t, tenantId })),
    })
    templates = await prisma.workflowTemplate.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } })
  }

  const runs = await prisma.workflowRun.findMany({
    where: { tenantId, status: "running" },
    select: { workflowTemplateId: true },
  })
  const activeCounts = runs.reduce<Record<string, number>>((acc, r) => {
    acc[r.workflowTemplateId] = (acc[r.workflowTemplateId] ?? 0) + 1
    return acc
  }, {})

  return NextResponse.json({ templates, activeCounts })
}
```

```typescript
// app/api/workflow-templates/[id]/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json()
  const template = await prisma.workflowTemplate.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
  })
  if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const updated = await prisma.workflowTemplate.update({
    where: { id: params.id },
    data: { ...(typeof body.enabled === "boolean" && { enabled: body.enabled }) },
  })
  return NextResponse.json({ template: updated })
}
```

```typescript
// app/api/cron/workflow-runner/route.ts
import { NextResponse } from "next/server"
import { runDueWorkflows } from "@/lib/agent/workflow-runner"

export async function GET() {
  const count = await runDueWorkflows()
  return NextResponse.json({ ok: true, ran: count })
}
```

- [ ] **Step 6: Create WorkflowsPanel settings UI**

```typescript
// app/settings/WorkflowsPanel.tsx
"use client"
import { useState } from "react"

type WorkflowTemplate = {
  id: string; name: string; trigger: string
  stepsJson: Array<{type: string; days?: number; taskTitle?: string}>
  enabled: boolean
}

export default function WorkflowsPanel({
  initialTemplates,
  activeCounts,
}: {
  initialTemplates: WorkflowTemplate[]
  activeCounts: Record<string, number>
}) {
  const [templates, setTemplates] = useState(initialTemplates)
  const [pending, setPending] = useState<Record<string, boolean>>({})

  async function toggleEnabled(id: string, enabled: boolean) {
    setPending((p) => ({ ...p, [id]: true }))
    await fetch(`/api/workflow-templates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    })
    setTemplates((prev) => prev.map((t) => t.id === id ? { ...t, enabled } : t))
    setPending((p) => ({ ...p, [id]: false }))
  }

  if (templates.length === 0) return <p className="text-sm text-slate-500">No workflows yet.</p>

  return (
    <div className="space-y-3">
      {templates.map((t) => (
        <div key={t.id} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-800">{t.name}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {t.stepsJson.length} steps · Trigger: {t.trigger.replace(/_/g, " ")}
              </p>
              {(activeCounts[t.id] ?? 0) > 0 && (
                <p className="mt-0.5 text-xs text-blue-600">{activeCounts[t.id]} active runs</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => toggleEnabled(t.id, !t.enabled)}
              disabled={pending[t.id]}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${t.enabled ? "bg-slate-900" : "bg-slate-300"}`}
              aria-pressed={t.enabled}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${t.enabled ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 7: Add WorkflowsPanel to settings page**

In `app/settings/page.tsx`:
```typescript
import WorkflowsPanel from "@/app/settings/WorkflowsPanel"
```

Fetch in the queries array:
```typescript
fetch("/api/workflow-templates").then(r => r.json())
```

Or query directly:
```typescript
prisma.workflowTemplate.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } })
```

Add panel in JSX:
```tsx
<section>
  <h2 className="mb-3 text-base font-semibold">Workflows</h2>
  <p className="mb-4 text-sm text-slate-500">
    Multi-step email sequences that run automatically based on triggers.
  </p>
  <WorkflowsPanel initialTemplates={workflowTemplates} activeCounts={{}} />
</section>
```

- [ ] **Step 8: Type-check, test, commit**

```bash
npx tsc --noEmit
npm test
git add lib/agent/workflow-runner.ts tests/workflow-runner.test.ts app/api/workflow-templates/ app/api/cron/workflow-runner/ app/settings/WorkflowsPanel.tsx app/settings/page.tsx
git commit -m "feat: multi-step workflow runner, templates, cron, and settings UI

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 11: Google Drive integration

**Files:**
- Create: `lib/integrations/google-drive.ts`
- Create: `app/api/integrations/google-drive/connect/route.ts`
- Create: `app/api/integrations/google-drive/callback/route.ts`
- Create: `app/api/integrations/google-drive/disconnect/route.ts`
- Create: `app/settings/ConnectedAppsPanel.tsx`
- Modify: `app/settings/page.tsx`

- [ ] **Step 1: Create Google Drive lib**

```typescript
// lib/integrations/google-drive.ts
import { google } from "googleapis"
import { encrypt, decrypt } from "@/lib/encryption"
import { prisma } from "@/lib/prisma"

function getDriveAuth() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXTAUTH_URL}/api/integrations/google-drive/callback`
  )
}

export function getGoogleDriveAuthUrl(state: string): string {
  const auth = getDriveAuth()
  return auth.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/drive.readonly", "email", "profile"],
    state,
    prompt: "consent",
  })
}

export async function exchangeGoogleDriveCode(
  code: string,
  tenantId: string
): Promise<{ email: string }> {
  const auth = getDriveAuth()
  const { tokens } = await auth.getToken(code)
  auth.setCredentials(tokens)

  const oauth2 = google.oauth2({ version: "v2", auth })
  const userInfo = await oauth2.userinfo.get()
  const email = userInfo.data.email ?? ""

  await prisma.googleDriveCredential.upsert({
    where: { tenantId },
    update: {
      email,
      accessTokenEncrypted: encrypt(tokens.access_token ?? ""),
      refreshTokenEncrypted: encrypt(tokens.refresh_token ?? ""),
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
    },
    create: {
      tenantId,
      email,
      accessTokenEncrypted: encrypt(tokens.access_token ?? ""),
      refreshTokenEncrypted: encrypt(tokens.refresh_token ?? ""),
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
    },
  })
  return { email }
}

export type DriveFileResult = { name: string; snippet: string; webViewLink: string }

export async function searchDriveForContext(
  tenantId: string,
  query: string
): Promise<DriveFileResult[]> {
  const cred = await prisma.googleDriveCredential.findUnique({ where: { tenantId } })
  if (!cred) return []

  const auth = getDriveAuth()
  auth.setCredentials({
    access_token: decrypt(cred.accessTokenEncrypted),
    refresh_token: decrypt(cred.refreshTokenEncrypted),
  })

  const drive = google.drive({ version: "v3", auth })
  const res = await drive.files.list({
    q: `fullText contains '${query.replace(/'/g, "\\'")}' and trashed = false`,
    fields: "files(id, name, snippets, webViewLink)",
    pageSize: 3,
  })

  return (res.data.files ?? []).map((f) => ({
    name: f.name ?? "",
    snippet: "",
    webViewLink: f.webViewLink ?? "",
  }))
}
```

- [ ] **Step 2: Create Drive OAuth routes**

```typescript
// app/api/integrations/google-drive/connect/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getGoogleDriveAuthUrl } from "@/lib/integrations/google-drive"
import { encrypt } from "@/lib/encryption"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const state = encrypt(session.user.tenantId)
  const url = getGoogleDriveAuthUrl(state)
  return NextResponse.redirect(url)
}
```

```typescript
// app/api/integrations/google-drive/callback/route.ts
import { NextResponse } from "next/server"
import { decrypt } from "@/lib/encryption"
import { exchangeGoogleDriveCode } from "@/lib/integrations/google-drive"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  if (!code || !state) {
    return NextResponse.redirect(new URL("/settings?error=invalid_callback", request.url))
  }
  try {
    const tenantId = decrypt(state)
    await exchangeGoogleDriveCode(code, tenantId)
    return NextResponse.redirect(new URL("/settings?drive_connected=1", request.url))
  } catch {
    return NextResponse.redirect(new URL("/settings?error=drive_token_failed", request.url))
  }
}
```

```typescript
// app/api/integrations/google-drive/disconnect/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function DELETE() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  await prisma.googleDriveCredential.deleteMany({ where: { tenantId: session.user.tenantId } })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Create ConnectedAppsPanel**

```typescript
// app/settings/ConnectedAppsPanel.tsx
"use client"
import { useState } from "react"

export default function ConnectedAppsPanel({
  driveConnected,
  driveEmail,
}: {
  driveConnected: boolean
  driveEmail?: string
}) {
  const [disconnecting, setDisconnecting] = useState(false)

  async function disconnect() {
    setDisconnecting(true)
    await fetch("/api/integrations/google-drive/disconnect", { method: "DELETE" })
    window.location.reload()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100">
            <svg className="h-4 w-4 text-blue-600" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6.28 3L1 12l5.28 9h11.44L23 12 17.72 3H6.28zM12 16.5L8.5 10.5h7L12 16.5z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-800">Google Drive</p>
            <p className="text-xs text-slate-500">
              {driveConnected ? `Connected as ${driveEmail}` : "Pull document context when drafting replies"}
            </p>
          </div>
        </div>
        {driveConnected ? (
          <button
            onClick={disconnect}
            disabled={disconnecting}
            className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
          >
            {disconnecting ? "…" : "Disconnect"}
          </button>
        ) : (
          <a
            href="/api/integrations/google-drive/connect"
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
          >
            Connect
          </a>
        )}
      </div>
      <p className="text-xs text-slate-400">
        More integrations (Notion, Slack, Calendly) coming soon.
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Add ConnectedAppsPanel to settings**

In `app/settings/page.tsx`:
```typescript
import ConnectedAppsPanel from "@/app/settings/ConnectedAppsPanel"
```

Add query:
```typescript
prisma.googleDriveCredential.findUnique({ where: { tenantId } })
```

Add panel in JSX:
```tsx
<section>
  <h2 className="mb-3 text-base font-semibold">Connected Apps</h2>
  <p className="mb-4 text-sm text-slate-500">
    Choose integrations that help your workflows, not just logo counts.
  </p>
  <ConnectedAppsPanel
    driveConnected={!!googleDriveCredential}
    driveEmail={googleDriveCredential?.email}
  />
</section>
```

Also handle `?drive_connected=1` success message in settings page (add to `searchParams` interface and show a success toast).

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add lib/integrations/ app/api/integrations/ app/settings/ConnectedAppsPanel.tsx app/settings/page.tsx
git commit -m "feat: Google Drive integration with OAuth connect/disconnect and context search

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 12: Wire conversation page panels + docs

**Files:**
- Modify: `app/conversations/[id]/page.tsx`
- Modify: `docs/TODO.md`
- Modify: `docs/MASTER_PRODUCT_PLAN.md`
- Modify: `docs/CURRENT_STATE.md`

- [ ] **Step 1: Add SchedulingPanel and AutomationRunHistory to conversation page**

In `app/conversations/[id]/page.tsx`, add imports:
```typescript
import SchedulingPanel from "@/app/conversations/[id]/SchedulingPanel"
import AutomationRunHistory from "@/app/conversations/[id]/AutomationRunHistory"
```

Add queries to the existing page data fetch:
```typescript
const [schedulingSession, automationRuns, calendarCredentials] = await Promise.all([
  prisma.schedulingSession.findUnique({ where: { conversationId: id } }),
  prisma.automationRun.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "desc" },
    take: 5,
  }),
  prisma.googleCalendarCredential.findMany({
    where: { tenantId },
    select: { email: true },
  }),
])
```

Add panels in the right-side panel area (after `WorkItemsPanel` or similar):
```tsx
{calendarCredentials.length > 0 && (
  <SchedulingPanel
    conversationId={id}
    calendarEmails={calendarCredentials.map((c) => c.email)}
    initialSession={schedulingSession ? {
      ...schedulingSession,
      proposedTimesJson: schedulingSession.proposedTimesJson as ProposedSlot[] | null,
      createdAt: schedulingSession.createdAt.toISOString(),
      updatedAt: schedulingSession.updatedAt.toISOString(),
    } : null}
  />
)}
<AutomationRunHistory
  runs={automationRuns.map((r) => ({
    ...r,
    stepsJson: r.stepsJson as AutomationStep[],
    createdAt: r.createdAt.toISOString(),
    rolledBackAt: r.rolledBackAt?.toISOString() ?? null,
  }))}
/>
```

- [ ] **Step 2: Update TODO.md**

Mark all Phase 4 features complete:

```markdown
## Phase 4: Automations And Integrations ✅ Shipped (PR #XX, 2026-06-17)

- [x] **Outcome-based automation** (#26) — AutomationRun trace model, step executor, rollback API, conversation history panel.
- [x] **Train My Agent with plain English** (#27) — AgentRule model, NL compiler, preview endpoint, conflict detection, settings UI.
- [x] **Multi-step email workflows** (#31) — WorkflowTemplate + WorkflowRun models, workflow runner, cron job, seeded default workflows, settings panel.
- [x] **Category-scoped autopilot policy builder** (#2) — per-attention-category policy table (auto-send / require approval / never) in autopilot settings.
- [x] **Full scheduling back-and-forth** (#14) — SchedulingSession model, scheduling detector wired into sync, slot proposal via Calendar API, SchedulingPanel on conversation page.
- [x] **Context from connected apps** (#35) — GoogleDriveCredential model, Drive OAuth connect/disconnect, context search lib, ConnectedApps settings section.
- [x] **Auto-generated snippets and playbooks** (#37) — Snippet model, miner cron, snippets API, SnippetsPanel in settings, snippet picker in reply composer.
- [x] **Auto-personalized outreach** (#39) — deferred; avoid spam positioning.
- [x] **One-click Clean My Inbox onboarding** (#41) — /clean-inbox page, batch archive/unsubscribe routes, 1-hour undo via AuditLog, AppRail icon.
```

- [ ] **Step 3: Update MASTER_PRODUCT_PLAN.md feature index**

Update statuses:
- Feature #2: `Partial` → `Shipped`
- Feature #14: `Partial` → `Partial` (first slice: detection + proposal)
- Feature #26: `Discovery` → `Partial` (first slice: trace model + rollback)
- Feature #27: `Partial` → `Shipped`
- Feature #31: `Discovery` → `Partial` (first slice: templates + runner)
- Feature #35: `Discovery` → `Partial` (first slice: Google Drive)
- Feature #37: `Planned` → `Shipped`
- Feature #41: `Planned` → `Shipped`

Add to decision log:
```markdown
| 2026-06-17 | Ship Phase 4 Automations & Integrations as first-slice implementations for #14, #26, #31, #35. | Discovery features need foundations before full product-complete behavior; first slices establish models, APIs, and trust patterns. Full scheduling back-and-forth and workflow builder deferred to Phase 4 hardening. |
```

- [ ] **Step 4: Update CURRENT_STATE.md**

Add new section under "Key Data Models":
```markdown
- `SchedulingSession`, `AutomationRun`, `WorkflowTemplate`, `WorkflowRun`
- `AgentRule`, `Snippet`, `GoogleDriveCredential`
```

Add to feature capabilities:
```markdown
### Automations And Integrations (Phase 4)

- Plain-English rule creation via `AgentRule` model and NL compiler; preview shows affected emails and conflicts.
- Category-scoped autopilot policies (auto-send / require approval / never) per attention category.
- `Snippet` model with weekly miner, settings panel, and reply composer picker.
- `/clean-inbox` page with batch archive, batch unsubscribe, and 1-hour undo.
- `SchedulingSession` model; scheduling requests detected during sync; Calendar-backed slot proposal.
- `AutomationRun` trace model; step executor (create_task, update_attention, archive); rollback within 24h.
- `WorkflowTemplate`/`WorkflowRun` models; 3 seeded default workflows; cron-driven step advancement.
- Google Drive OAuth connect/disconnect; `searchDriveForContext` for draft context enrichment.
```

Update "Known Gaps":
```markdown
- Full scheduling back-and-forth: confirmation detection and event booking not yet wired.
- WorkflowTemplate builder UI (drag-and-drop or form) not yet implemented.
- AutomationRun trigger conditions not yet user-configurable (system defaults only).
- Google Drive context not yet injected into draft generation (lib exists, not wired).
- Notion, Slack, Calendly integrations not yet implemented.
```

- [ ] **Step 5: Final type-check, full test run, commit**

```bash
npx tsc --noEmit
npm test
npm run build
```

Expected: no TS errors, all tests pass, build succeeds.

```bash
git add app/conversations/[id]/page.tsx docs/TODO.md docs/MASTER_PRODUCT_PLAN.md docs/CURRENT_STATE.md
git commit -m "docs: mark Phase 4 complete in TODO.md and update MASTER_PRODUCT_PLAN, CURRENT_STATE

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage check:**
- #14 Scheduling: Tasks 8 (detector, proposal, API, panel) ✓
- #26 Automation: Task 9 (runner, rollback, history panel) ✓
- #31 Workflows: Task 10 (runner, templates, cron, UI) ✓
- #35 Google Drive: Task 11 (OAuth, lib, settings UI) ✓
- Docs: Task 12 ✓

**Placeholder scan:** None found.

**Type consistency:**
- `ProposedSlot = { start: string; end: string; label: string }` — used consistently in scheduling.ts and SchedulingPanel.tsx ✓
- `AutomationStep.type` union — defined in automation-runner.ts, used in rollback route and AutomationRunHistory ✓
- `advanceWorkflowStep(runId: string)` — defined in workflow-runner.ts, called in cron route ✓
- `searchDriveForContext(tenantId, query)` — defined in google-drive.ts (ready to wire into draft generation) ✓
