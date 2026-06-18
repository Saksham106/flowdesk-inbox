# Phase 3 v3.0 — Protection Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship life admin mode completion, VIP protection, phishing/fraud detection, and auto-unsubscribe — all extending the existing classifier pipeline with no new storage primitives except one new `VipContact` table.

**Architecture:** All four features follow the established pattern: pure classifier functions in `lib/agent/`, wired fire-and-forget into `syncConversationWorkItems` in `lib/agent/work-item-sync.ts`, results stored in `ConversationState.metadataJson`. VIP protection requires one new Prisma model. Phishing and unsubscribe detection store results as metadata fields only.

**Tech Stack:** TypeScript, Prisma (PostgreSQL), Next.js App Router, Vitest

**Spec:** `docs/archive/specs/2026-06-17-phase3-design.md`

---

## File Structure

**New files:**
- `prisma/migrations/20260617000000_add_vip_contacts/migration.sql` — VipContact table
- `lib/agent/life-admin.ts` — life admin category detection and task metadata extraction
- `lib/agent/vip-detector.ts` — VIP contact lookup (async, queries DB)
- `lib/agent/phishing-detector.ts` — phishing/fraud signal scoring (pure function)
- `lib/agent/unsubscribe.ts` — List-Unsubscribe header parsing + unsubscribe action
- `tests/life-admin.test.ts`
- `tests/phishing-detector.test.ts`
- `tests/unsubscribe.test.ts`
- `app/api/vip-contacts/route.ts` — GET + POST
- `app/api/vip-contacts/[id]/route.ts` — DELETE
- `app/api/conversations/[id]/phishing-safe/route.ts` — POST
- `app/api/conversations/[id]/unsubscribe/route.ts` — POST
- `app/settings/VipContactsForm.tsx` — add/remove VIP contacts

**Modified files:**
- `prisma/schema.prisma` — add VipContact model
- `lib/agent/work-item-sync.ts` — wire life admin, VIP, phishing, unsubscribe
- `app/inbox/page.tsx` — add "Life Admin" attention tab + VIP/phishing badges on rows
- `app/conversations/[id]/page.tsx` — VIP banner + phishing warning banner + unsubscribe button
- `app/settings/page.tsx` — import and render VipContactsForm

---

## Task 1: Life Admin Classifier

**Files:**
- Create: `lib/agent/life-admin.ts`
- Create: `tests/life-admin.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/life-admin.test.ts
import { describe, it, expect } from "vitest"
import { detectLifeAdminType, type LifeAdminResult } from "@/lib/agent/life-admin"

describe("detectLifeAdminType", () => {
  it("detects bill due with amount and date", () => {
    const result = detectLifeAdminType(
      "noreply@xfinity.com",
      "Your bill is due on July 15 — $89.99",
      "Your Xfinity bill of $89.99 is due July 15. Pay now to avoid late fees."
    )
    expect(result.type).toBe("bill_due")
    expect(result.amount).toBe(89.99)
    expect(result.currency).toBe("USD")
  })

  it("detects travel confirmation", () => {
    const result = detectLifeAdminType(
      "reservations@delta.com",
      "Your flight confirmation — DL 1234",
      "Your Delta flight DL 1234 departs June 22 at 10:30 AM from JFK to LAX."
    )
    expect(result.type).toBe("travel_confirmation")
    expect(result.type).not.toBe(null)
  })

  it("detects medical appointment", () => {
    const result = detectLifeAdminType(
      "noreply@myhealth.com",
      "Appointment Reminder: Dr. Smith on June 25",
      "You have an appointment with Dr. Smith on June 25 at 2:00 PM."
    )
    expect(result.type).toBe("medical_appointment")
  })

  it("detects subscription renewal with amount", () => {
    const result = detectLifeAdminType(
      "billing@netflix.com",
      "Your Netflix subscription renews on July 1",
      "Your Netflix plan will automatically renew on July 1 for $15.49."
    )
    expect(result.type).toBe("subscription_renewal")
    expect(result.amount).toBe(15.49)
  })

  it("detects school notice", () => {
    const result = detectLifeAdminType(
      "noreply@school.edu",
      "Grade report available",
      "Your final grade report for Spring 2026 is now available."
    )
    expect(result.type).toBe("school_notice")
  })

  it("returns null for unrelated email", () => {
    const result = detectLifeAdminType(
      "friend@gmail.com",
      "Hey want to grab lunch?",
      "Let me know if you're free Thursday."
    )
    expect(result.type).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- --reporter=verbose tests/life-admin.test.ts
```
Expected: FAIL — `Cannot find module '@/lib/agent/life-admin'`

- [ ] **Step 3: Implement `lib/agent/life-admin.ts`**

```typescript
export type LifeAdminType =
  | "bill_due"
  | "travel_confirmation"
  | "medical_appointment"
  | "subscription_renewal"
  | "school_notice"

export type LifeAdminResult = {
  type: LifeAdminType | null
  amount?: number
  currency?: string
  description?: string
}

const BILL_PATTERN =
  /\b(bill|invoice|payment due|amount due|balance due|statement|past due|pay by|due (on|date))\b/i
const TRAVEL_PATTERN =
  /\b(flight|confirmation|booking|reservation|itinerary|hotel|check-in|departure|arrival|boarding pass|e-ticket)\b/i
const MEDICAL_PATTERN =
  /\b(appointment|reminder|dr\.|doctor|clinic|hospital|health|dental|vision|therapy|telehealth|patient)\b/i
const SUBSCRIPTION_PATTERN =
  /\b(subscription|renews?|renewal|auto.renew|next billing|your plan|membership renews?)\b/i
const SCHOOL_PATTERN =
  /\b(grade|report card|transcript|enrollment|tuition|semester|course|academic|school|university|college|student)\b/i

const AMOUNT_PATTERN = /\$\s*([\d,]+(?:\.\d{2})?)/

function extractAmount(text: string): { amount?: number; currency?: string } {
  const match = text.match(AMOUNT_PATTERN)
  if (!match) return {}
  const amount = parseFloat(match[1].replace(/,/g, ""))
  return isNaN(amount) ? {} : { amount, currency: "USD" }
}

export function detectLifeAdminType(
  fromEmail: string,
  subject: string,
  body: string
): LifeAdminResult {
  const text = `${subject}\n${body}`

  if (BILL_PATTERN.test(text) && AMOUNT_PATTERN.test(text)) {
    return { type: "bill_due", ...extractAmount(text) }
  }
  if (TRAVEL_PATTERN.test(text)) {
    return { type: "travel_confirmation" }
  }
  if (MEDICAL_PATTERN.test(text)) {
    return { type: "medical_appointment" }
  }
  if (SUBSCRIPTION_PATTERN.test(text)) {
    return { type: "subscription_renewal", ...extractAmount(text) }
  }
  if (SCHOOL_PATTERN.test(text)) {
    return { type: "school_notice" }
  }
  return { type: null }
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npm test -- --reporter=verbose tests/life-admin.test.ts
```
Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/agent/life-admin.ts tests/life-admin.test.ts
git commit -m "feat: add life admin classifier (bill, travel, medical, subscription, school)"
```

---

## Task 2: Wire Life Admin into work-item-sync + Inbox Tab

**Files:**
- Modify: `lib/agent/work-item-sync.ts`
- Modify: `app/inbox/page.tsx`

- [ ] **Step 1: Import and call detectLifeAdminType in work-item-sync**

In `lib/agent/work-item-sync.ts`, add the import at the top:

```typescript
import { detectLifeAdminType } from "@/lib/agent/life-admin"
```

Then after the email classification block (after `detectedAttentionCategory` is set), add before the final `return` statement of `syncConversationWorkItems`:

```typescript
  // Life admin detection — runs for all accounts
  if (firstInbound) {
    const fromEmail = extractEmail(firstInbound.fromE164 ?? "")
    const lifeAdminResult = detectLifeAdminType(
      fromEmail,
      firstInbound.body.slice(0, 200),
      firstInbound.body
    )
    if (lifeAdminResult.type) {
      const currentState = await prisma.conversationState.findUnique({
        where: { conversationId: conversation.id },
        select: { metadataJson: true },
      })
      const currentMeta =
        currentState?.metadataJson &&
        typeof currentState.metadataJson === "object" &&
        !Array.isArray(currentState.metadataJson)
          ? (currentState.metadataJson as Record<string, unknown>)
          : {}
      await prisma.conversationState.update({
        where: { conversationId: conversation.id },
        data: {
          metadataJson: {
            ...currentMeta,
            lifeAdminType: lifeAdminResult.type,
            lifeAdminAmount: lifeAdminResult.amount ?? null,
            lifeAdminCurrency: lifeAdminResult.currency ?? null,
          } as Prisma.InputJsonValue,
        },
      })
      // Create InboxTask for actionable life-admin types
      if (["bill_due", "medical_appointment", "subscription_renewal"].includes(lifeAdminResult.type)) {
        const taskTitle =
          lifeAdminResult.type === "bill_due"
            ? `Pay bill${lifeAdminResult.amount ? ` — $${lifeAdminResult.amount}` : ""}`
            : lifeAdminResult.type === "medical_appointment"
            ? "Medical appointment"
            : `Subscription renewal${lifeAdminResult.amount ? ` — $${lifeAdminResult.amount}` : ""}`
        const deterministicKey = `life_admin:${conversation.id}:${lifeAdminResult.type}`
        await prisma.inboxTask.upsert({
          where: { deterministicKey },
          create: {
            tenantId: conversation.tenantId,
            conversationId: conversation.id,
            title: taskTitle,
            status: "open",
            source: "deterministic",
            deterministicKey,
            metadataJson: { lifeAdminType: lifeAdminResult.type } as Prisma.InputJsonValue,
          },
          update: { title: taskTitle },
        })
      }
    }
  }
```

- [ ] **Step 2: Add "Life Admin" tab to inbox page**

In `app/inbox/page.tsx`, find the attention tabs array:

```typescript
{(["needs_reply", "review_soon", "read_later"] as const).map((cat) => {
  const labels: Record<string, string> = { needs_reply: "Reply", review_soon: "Review", read_later: "Later" }
```

Replace with:

```typescript
{(["needs_reply", "review_soon", "read_later", "life_admin"] as const).map((cat) => {
  const labels: Record<string, string> = {
    needs_reply: "Reply",
    review_soon: "Review",
    read_later: "Later",
    life_admin: "Life Admin",
  }
```

Then update the `displayConversations` filter block. Find where `attentionFilter` is used to filter by `attentionCategory` and extend it to also match `lifeAdminType`:

```typescript
: attentionFilter
  ? allConversations.filter((c) => {
      const meta = c.stateRecord?.metadataJson
      if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false
      const m = meta as Record<string, unknown>
      if (attentionFilter === "life_admin") return !!m.lifeAdminType
      return m.attentionCategory === attentionFilter
    })
  : allConversations
```

- [ ] **Step 3: Commit**

```bash
git add lib/agent/work-item-sync.ts app/inbox/page.tsx
git commit -m "feat: wire life admin detection into sync pipeline; add Life Admin inbox tab"
```

---

## Task 3: VIP Contact Migration + Schema

**Files:**
- Create: `prisma/migrations/20260617000000_add_vip_contacts/migration.sql`
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Create migration SQL**

```sql
-- prisma/migrations/20260617000000_add_vip_contacts/migration.sql
CREATE TABLE "VipContact" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "domain" TEXT,
  "label" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VipContact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VipContact_tenantId_email_key" ON "VipContact"("tenantId", "email");
CREATE INDEX "VipContact_tenantId_idx" ON "VipContact"("tenantId");

ALTER TABLE "VipContact" ADD CONSTRAINT "VipContact_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 2: Apply migration**

```bash
npx prisma db execute --file prisma/migrations/20260617000000_add_vip_contacts/migration.sql
npx prisma migrate resolve --applied 20260617000000_add_vip_contacts
npx prisma generate
```

Expected: "Migration 20260617000000_add_vip_contacts marked as applied."

- [ ] **Step 3: Add VipContact to schema.prisma**

Add after the last model in `prisma/schema.prisma`:

```prisma
model VipContact {
  id        String   @id @default(cuid())
  tenantId  String
  email     String
  domain    String?
  label     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, email])
  @@index([tenantId])
}
```

Also add `vipContacts VipContact[]` to the `Tenant` model's relation list.

- [ ] **Step 4: Commit**

```bash
git add prisma/migrations/20260617000000_add_vip_contacts/ prisma/schema.prisma
git commit -m "feat: add VipContact model and migration"
```

---

## Task 4: VIP Detector + API Routes

**Files:**
- Create: `lib/agent/vip-detector.ts`
- Create: `app/api/vip-contacts/route.ts`
- Create: `app/api/vip-contacts/[id]/route.ts`

- [ ] **Step 1: Create `lib/agent/vip-detector.ts`**

```typescript
import { prisma } from "@/lib/prisma"

export type VipDetectorResult = {
  isVip: boolean
  label?: string
}

export async function detectVip(
  fromEmail: string,
  tenantId: string
): Promise<VipDetectorResult> {
  const emailLower = fromEmail.toLowerCase()
  const domain = emailLower.split("@")[1] ?? ""

  const match = await prisma.vipContact.findFirst({
    where: {
      tenantId,
      OR: [
        { email: emailLower },
        { domain: domain },
      ],
    },
    select: { label: true },
  })

  if (!match) return { isVip: false }
  return { isVip: true, label: match.label ?? undefined }
}
```

- [ ] **Step 2: Create `app/api/vip-contacts/route.ts`**

```typescript
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const vips = await prisma.vipContact.findMany({
    where: { tenantId: session.user.tenantId },
    orderBy: { createdAt: "asc" },
  })
  return NextResponse.json({ vips })
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const body = await request.json()
  const { email, domain, label } = body ?? {}
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "email required" }, { status: 400 })
  }
  const vip = await prisma.vipContact.upsert({
    where: { tenantId_email: { tenantId: session.user.tenantId, email: email.toLowerCase() } },
    create: { tenantId: session.user.tenantId, email: email.toLowerCase(), domain: domain ?? null, label: label ?? null },
    update: { domain: domain ?? null, label: label ?? null },
  })
  return NextResponse.json({ vip })
}
```

- [ ] **Step 3: Create `app/api/vip-contacts/[id]/route.ts`**

```typescript
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const vip = await prisma.vipContact.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
  })
  if (!vip) return NextResponse.json({ error: "Not found" }, { status: 404 })
  await prisma.vipContact.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Wire VIP detection into work-item-sync**

In `lib/agent/work-item-sync.ts`, add import:

```typescript
import { detectVip } from "@/lib/agent/vip-detector"
```

After the life admin block, add:

```typescript
  // VIP detection
  if (firstInbound) {
    const fromEmail = extractEmail(firstInbound.fromE164 ?? "")
    const vipResult = await detectVip(fromEmail, conversation.tenantId)
    if (vipResult.isVip) {
      const currentState = await prisma.conversationState.findUnique({
        where: { conversationId: conversation.id },
        select: { metadataJson: true },
      })
      const currentMeta =
        currentState?.metadataJson &&
        typeof currentState.metadataJson === "object" &&
        !Array.isArray(currentState.metadataJson)
          ? (currentState.metadataJson as Record<string, unknown>)
          : {}
      await prisma.conversationState.update({
        where: { conversationId: conversation.id },
        data: {
          priority: "urgent",
          metadataJson: {
            ...currentMeta,
            isVip: true,
            vipLabel: vipResult.label ?? null,
          } as Prisma.InputJsonValue,
        },
      })
    }
  }
```

- [ ] **Step 5: Commit**

```bash
git add lib/agent/vip-detector.ts app/api/vip-contacts/ lib/agent/work-item-sync.ts
git commit -m "feat: add VIP detector, API routes, wire into sync pipeline"
```

---

## Task 5: VIP UI — Badge in Inbox + Banner on Conversation + Settings Form

**Files:**
- Modify: `app/inbox/page.tsx`
- Modify: `app/conversations/[id]/page.tsx`
- Create: `app/settings/VipContactsForm.tsx`
- Modify: `app/settings/page.tsx`

- [ ] **Step 1: Add VIP badge to inbox rows**

In `app/inbox/page.tsx`, find where conversation data is mapped to the `<InboxRow>` component. The metadata is available from `conversation.stateRecord?.metadataJson`. Add VIP indicator in the snippet or name area.

Find the section that renders each conversation row and add VIP label before the name:

```tsx
{/* Add isVip prop to InboxRow rendering */}
```

First, add `isVip` and `vipLabel` to the data extracted per conversation:

```typescript
const meta = c.stateRecord?.metadataJson as Record<string, unknown> | null ?? {}
const isVip = meta?.isVip === true
const vipLabel = typeof meta?.vipLabel === "string" ? meta.vipLabel : null
```

Then pass to `<InboxRow isVip={isVip} vipLabel={vipLabel} ... />`

In `app/components/InboxRow.tsx`, add `isVip?: boolean` and `vipLabel?: string | null` to `InboxRowProps`, then inside the name display area:

```tsx
{isVip && (
  <span className="ml-1 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
    ⭐ {vipLabel ?? "VIP"}
  </span>
)}
```

- [ ] **Step 2: Add VIP banner to conversation page**

In `app/conversations/[id]/page.tsx`, extract VIP metadata from the conversation's state record (already loaded on the page). Above the thread header, add:

```tsx
{isVip && (
  <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800">
    ⭐ VIP{vipLabel ? ` — ${vipLabel}` : ""}
  </div>
)}
```

Pull `isVip` and `vipLabel` from `conversation.stateRecord?.metadataJson` (the page already fetches the state record).

- [ ] **Step 3: Create VipContactsForm.tsx**

```tsx
// app/settings/VipContactsForm.tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

type VipContact = {
  id: string
  email: string
  label: string | null
}

export default function VipContactsForm({ initialVips }: { initialVips: VipContact[] }) {
  const router = useRouter()
  const [vips, setVips] = useState<VipContact[]>(initialVips)
  const [email, setEmail] = useState("")
  const [label, setLabel] = useState("")
  const [saving, setSaving] = useState(false)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setSaving(true)
    const res = await fetch("/api/vip-contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), label: label.trim() || null }),
    })
    if (res.ok) {
      const { vip } = await res.json()
      setVips((prev) => [...prev, vip])
      setEmail("")
      setLabel("")
      router.refresh()
    }
    setSaving(false)
  }

  async function remove(id: string) {
    await fetch(`/api/vip-contacts/${id}`, { method: "DELETE" })
    setVips((prev) => prev.filter((v) => v.id !== id))
    router.refresh()
  }

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-slate-900">VIP Contacts</h2>
      <p className="text-xs text-slate-500">Emails from VIP contacts are always surfaced first with urgent priority.</p>
      <form onSubmit={add} className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@example.com"
          className="flex-1 rounded border border-slate-200 px-3 py-1.5 text-sm"
          required
        />
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          className="w-36 rounded border border-slate-200 px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          Add
        </button>
      </form>
      <ul className="space-y-1">
        {vips.map((v) => (
          <li key={v.id} className="flex items-center justify-between rounded border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
            <span>⭐ {v.email}{v.label ? ` — ${v.label}` : ""}</span>
            <button onClick={() => remove(v.id)} className="text-xs text-red-500 hover:underline">Remove</button>
          </li>
        ))}
        {vips.length === 0 && <li className="text-xs text-slate-400">No VIP contacts yet.</li>}
      </ul>
    </section>
  )
}
```

- [ ] **Step 4: Add VipContactsForm to settings page**

In `app/settings/page.tsx`, add to the parallel data fetch:

```typescript
prisma.vipContact.findMany({
  where: { tenantId: session.user.tenantId },
  orderBy: { createdAt: "asc" },
  select: { id: true, email: true, label: true },
}),
```

Destructure the result and pass to the form. Import `VipContactsForm`:

```typescript
import VipContactsForm from "@/app/settings/VipContactsForm"
```

Render it in the settings page JSX, below the existing sections:

```tsx
<section className="mt-8">
  <VipContactsForm initialVips={vipContacts} />
</section>
```

- [ ] **Step 5: Commit**

```bash
git add app/inbox/page.tsx app/components/InboxRow.tsx app/conversations/[id]/page.tsx app/settings/VipContactsForm.tsx app/settings/page.tsx
git commit -m "feat: VIP badge in inbox rows, VIP banner on conversation page, VIP settings form"
```

---

## Task 6: Phishing Detector

**Files:**
- Create: `lib/agent/phishing-detector.ts`
- Create: `tests/phishing-detector.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/phishing-detector.test.ts
import { describe, it, expect } from "vitest"
import { detectPhishing, type PhishingResult } from "@/lib/agent/phishing-detector"

describe("detectPhishing", () => {
  it("flags likely phishing: lookalike domain + urgency + account language", () => {
    const result = detectPhishing(
      "support@paypa1.com",
      "paypa1@phishers.com",
      "Your account has been suspended",
      "Verify your account immediately or it will be permanently deleted. Click here: http://paypa1.com/verify"
    )
    expect(result.verdict).toBe("likely_phishing")
    expect(result.score).toBeGreaterThanOrEqual(70)
    expect(result.signals).toContain("lookalike_domain")
  })

  it("flags suspicious: IRS impersonation on non-irs.gov domain", () => {
    const result = detectPhishing(
      "IRS Tax Department <irs-notice@taxalert.net>",
      "irs-notice@taxalert.net",
      "Urgent: IRS Notice — action required",
      "You owe $1,847 in back taxes. Pay immediately to avoid penalties."
    )
    expect(result.verdict).not.toBe("safe")
    expect(result.signals.length).toBeGreaterThan(0)
  })

  it("does not flag legitimate PayPal email", () => {
    const result = detectPhishing(
      "service@paypal.com",
      "service@paypal.com",
      "Your PayPal receipt",
      "You sent $50.00 to Jane Doe."
    )
    expect(result.verdict).toBe("safe")
  })

  it("flags 'you have won' scam phrase", () => {
    const result = detectPhishing(
      "winner@prize-notify.com",
      "winner@prize-notify.com",
      "Congratulations! You have won $10,000",
      "You have won our weekly lottery. Send us your details to claim your prize."
    )
    expect(result.score).toBeGreaterThan(30)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- --reporter=verbose tests/phishing-detector.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement `lib/agent/phishing-detector.ts`**

```typescript
export type PhishingVerdict = "safe" | "suspicious" | "likely_phishing"

export type PhishingResult = {
  verdict: PhishingVerdict
  score: number
  signals: string[]
}

// Known legitimate domains for common impersonation targets
const LEGITIMATE_DOMAINS: Record<string, string> = {
  paypal: "paypal.com",
  apple: "apple.com",
  google: "google.com",
  microsoft: "microsoft.com",
  amazon: "amazon.com",
  netflix: "netflix.com",
  irs: "irs.gov",
  "social security": "ssa.gov",
  medicare: "medicare.gov",
  chase: "chase.com",
  "bank of america": "bankofamerica.com",
  citibank: "citibank.com",
  wellsfargo: "wellsfargo.com",
}

// Lookalike character substitutions (homoglyphs)
const HOMOGLYPHS: Record<string, string> = {
  "0": "o",
  "1": "l",
  "3": "e",
  "4": "a",
  "5": "s",
  "@": "a",
  "rn": "m",
}

const SUSPICIOUS_TLDS = new Set([".xyz", ".top", ".click", ".loan", ".win", ".work", ".gq", ".tk", ".ml", ".ga", ".cf"])

const URGENCY_PATTERN =
  /\b(immediately|urgent|asap|right now|within 24 hours|within 48 hours|account (suspended|locked|closed|compromised)|verify now|act now|final warning)\b/i

const SCAM_PHRASES =
  /\b(you have won|send gift cards?|wire transfer|western union|moneygram|bitcoin wallet|you('ve| have) been selected|claim your (prize|reward|gift))\b/i

const IMPERSONATION_NAMES =
  /\b(irs|internal revenue|federal bureau|fbi|social security|ssa|paypal|apple id|google account|microsoft support|amazon support|netflix|bank of america|citibank|wells fargo|chase bank|medicare|medicaid)\b/i

function extractDomain(email: string): string {
  const match = email.match(/@([^>\s]+)/)
  return match ? match[1].toLowerCase().trim() : ""
}

function isLookalikeOf(domain: string, brand: string): boolean {
  let normalized = domain
  for (const [glyph, real] of Object.entries(HOMOGLYPHS)) {
    normalized = normalized.split(glyph).join(real)
  }
  return normalized.includes(brand) && normalized !== brand + ".com" && normalized !== brand + ".gov"
}

export function detectPhishing(
  fromHeader: string,
  replyTo: string,
  subject: string,
  body: string
): PhishingResult {
  const signals: string[] = []
  let score = 0
  const text = `${subject}\n${body}`
  const fromDomain = extractDomain(fromHeader)
  const replyToDomain = extractDomain(replyTo)

  // Signal: mismatched reply-to vs from domain
  if (replyToDomain && fromDomain && replyToDomain !== fromDomain) {
    signals.push("mismatched_reply_to")
    score += 25
  }

  // Signal: lookalike domain (homoglyphs)
  for (const brand of Object.keys(LEGITIMATE_DOMAINS)) {
    if (isLookalikeOf(fromDomain, brand.replace(/\s/g, ""))) {
      signals.push("lookalike_domain")
      score += 40
      break
    }
  }

  // Signal: suspicious TLD
  for (const tld of SUSPICIOUS_TLDS) {
    if (fromDomain.endsWith(tld)) {
      signals.push("suspicious_tld")
      score += 20
      break
    }
  }

  // Signal: impersonation name in from header but not on legitimate domain
  const impersonationMatch = fromHeader.match(IMPERSONATION_NAMES)
  if (impersonationMatch) {
    const brand = impersonationMatch[0].toLowerCase().replace(/\s/g, "")
    const legitimateDomain = Object.entries(LEGITIMATE_DOMAINS).find(([k]) =>
      k.replace(/\s/g, "") === brand
    )?.[1]
    if (legitimateDomain && !fromDomain.endsWith(legitimateDomain)) {
      signals.push("impersonation")
      score += 35
    }
  }

  // Signal: urgency + account language
  if (URGENCY_PATTERN.test(text)) {
    signals.push("urgency_language")
    score += 15
  }

  // Signal: known scam phrases
  if (SCAM_PHRASES.test(text)) {
    signals.push("scam_phrase")
    score += 30
  }

  const verdict: PhishingVerdict =
    score >= 70 ? "likely_phishing" : score >= 30 ? "suspicious" : "safe"

  return { verdict, score, signals }
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npm test -- --reporter=verbose tests/phishing-detector.test.ts
```
Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/agent/phishing-detector.ts tests/phishing-detector.test.ts
git commit -m "feat: add phishing/fraud/scam detector with signal scoring"
```

---

## Task 7: Wire Phishing into work-item-sync + API + Conversation Banner

**Files:**
- Modify: `lib/agent/work-item-sync.ts`
- Create: `app/api/conversations/[id]/phishing-safe/route.ts`
- Modify: `app/conversations/[id]/page.tsx`

- [ ] **Step 1: Wire phishing detection into work-item-sync**

In `lib/agent/work-item-sync.ts`, add import:

```typescript
import { detectPhishing } from "@/lib/agent/phishing-detector"
```

After the VIP detection block, add:

```typescript
  // Phishing detection
  if (firstInbound) {
    const fromHeader = firstInbound.fromE164 ?? ""
    const fromEmail = extractEmail(fromHeader)
    const phishingResult = detectPhishing(
      fromHeader,
      fromEmail, // reply-to not separately stored; use from as fallback
      firstInbound.body.slice(0, 200),
      firstInbound.body
    )
    if (phishingResult.verdict !== "safe") {
      const currentState = await prisma.conversationState.findUnique({
        where: { conversationId: conversation.id },
        select: { metadataJson: true },
      })
      const currentMeta =
        currentState?.metadataJson &&
        typeof currentState.metadataJson === "object" &&
        !Array.isArray(currentState.metadataJson)
          ? (currentState.metadataJson as Record<string, unknown>)
          : {}
      if (!currentMeta.phishingMarkedSafe) {
        await prisma.conversationState.update({
          where: { conversationId: conversation.id },
          data: {
            metadataJson: {
              ...currentMeta,
              phishingVerdict: phishingResult.verdict,
              phishingScore: phishingResult.score,
              phishingSignals: phishingResult.signals,
            } as Prisma.InputJsonValue,
          },
        })
      }
    }
  }
```

- [ ] **Step 2: Create phishing-safe API route**

```typescript
// app/api/conversations/[id]/phishing-safe/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

export async function POST(
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
      metadataJson: {
        ...meta,
        phishingMarkedSafe: true,
        phishingVerdict: null,
      } as Prisma.InputJsonValue,
    },
  })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Add phishing banner to conversation page**

In `app/conversations/[id]/page.tsx`, extract phishing metadata from `conversation.stateRecord?.metadataJson`.

Add after the VIP banner:

```tsx
{phishingVerdict && phishingVerdict !== "safe" && !phishingMarkedSafe && (
  <PhishingWarningBanner
    conversationId={conversation.id}
    verdict={phishingVerdict as "suspicious" | "likely_phishing"}
  />
)}
```

Create `app/conversations/[id]/PhishingWarningBanner.tsx`:

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function PhishingWarningBanner({
  conversationId,
  verdict,
}: {
  conversationId: string
  verdict: "suspicious" | "likely_phishing"
}) {
  const router = useRouter()
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  const isHighRisk = verdict === "likely_phishing"

  async function markSafe() {
    await fetch(`/api/conversations/${conversationId}/phishing-safe`, { method: "POST" })
    setDismissed(true)
    router.refresh()
  }

  return (
    <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${isHighRisk ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
      <span className="mt-0.5 text-lg">🛡</span>
      <div className="flex-1">
        <p className="font-medium">
          {isHighRisk
            ? "This email shows strong signs of phishing — do not click links or share personal information."
            : "This email has some suspicious characteristics — proceed with caution."}
        </p>
      </div>
      <button onClick={markSafe} className="shrink-0 text-xs underline opacity-70 hover:opacity-100">
        Mark as safe
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add lib/agent/work-item-sync.ts app/api/conversations/[id]/phishing-safe/ app/conversations/[id]/PhishingWarningBanner.tsx app/conversations/[id]/page.tsx
git commit -m "feat: wire phishing detection into sync, add warning banner + mark-safe route"
```

---

## Task 8: Auto-Unsubscribe Detection + API + UI

**Files:**
- Create: `lib/agent/unsubscribe.ts`
- Create: `tests/unsubscribe.test.ts`
- Create: `app/api/conversations/[id]/unsubscribe/route.ts`
- Modify: `lib/agent/work-item-sync.ts`
- Modify: `app/conversations/[id]/page.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unsubscribe.test.ts
import { describe, it, expect } from "vitest"
import { parseUnsubscribeInfo, type UnsubscribeInfo } from "@/lib/agent/unsubscribe"

describe("parseUnsubscribeInfo", () => {
  it("extracts List-Unsubscribe header URL", () => {
    const result = parseUnsubscribeInfo(
      "<https://example.com/unsubscribe?token=abc123>",
      "Check out our newsletter. Click here to read more."
    )
    expect(result.hasUnsubscribeLink).toBe(true)
    expect(result.unsubscribeUrl).toBe("https://example.com/unsubscribe?token=abc123")
  })

  it("extracts unsubscribe link from body when no header", () => {
    const result = parseUnsubscribeInfo(
      null,
      'To unsubscribe from these emails, <a href="https://example.com/optout">click here</a>.'
    )
    expect(result.hasUnsubscribeLink).toBe(true)
    expect(result.unsubscribeUrl).toContain("optout")
  })

  it("returns false when no unsubscribe link present", () => {
    const result = parseUnsubscribeInfo(null, "Hey, just wanted to say hi!")
    expect(result.hasUnsubscribeLink).toBe(false)
    expect(result.unsubscribeUrl).toBeNull()
  })

  it("skips mailto: links", () => {
    const result = parseUnsubscribeInfo("<mailto:unsub@example.com>", "some body text")
    // mailto: is skipped; no URL found
    expect(result.hasUnsubscribeLink).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- --reporter=verbose tests/unsubscribe.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement `lib/agent/unsubscribe.ts`**

```typescript
export type UnsubscribeInfo = {
  hasUnsubscribeLink: boolean
  unsubscribeUrl: string | null
}

const BODY_UNSUBSCRIBE_PATTERN =
  /href=["'](https?:\/\/[^"']*(?:unsubscribe|optout|opt-out|opt_out|remove)[^"']*)/i

export function parseUnsubscribeInfo(
  listUnsubscribeHeader: string | null,
  bodyHtml: string
): UnsubscribeInfo {
  // Parse List-Unsubscribe header — only accept https:// URLs, skip mailto:
  if (listUnsubscribeHeader) {
    const urlMatch = listUnsubscribeHeader.match(/<(https?:\/\/[^>]+)>/)
    if (urlMatch) {
      return { hasUnsubscribeLink: true, unsubscribeUrl: urlMatch[1] }
    }
  }

  // Fall back to body scan
  const bodyMatch = bodyHtml.match(BODY_UNSUBSCRIBE_PATTERN)
  if (bodyMatch) {
    return { hasUnsubscribeLink: true, unsubscribeUrl: bodyMatch[1] }
  }

  return { hasUnsubscribeLink: false, unsubscribeUrl: null }
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npm test -- --reporter=verbose tests/unsubscribe.test.ts
```
Expected: all 4 tests PASS

- [ ] **Step 5: Wire into work-item-sync**

In `lib/agent/work-item-sync.ts`, add import:

```typescript
import { parseUnsubscribeInfo } from "@/lib/agent/unsubscribe"
```

After the phishing block, add:

```typescript
  // Unsubscribe detection
  if (firstInbound) {
    const listUnsubHeader: string | null = null // Gmail API headers not stored separately; parse from body only
    const unsubInfo = parseUnsubscribeInfo(listUnsubHeader, firstInbound.body)
    if (unsubInfo.hasUnsubscribeLink) {
      const currentState = await prisma.conversationState.findUnique({
        where: { conversationId: conversation.id },
        select: { metadataJson: true },
      })
      const currentMeta =
        currentState?.metadataJson &&
        typeof currentState.metadataJson === "object" &&
        !Array.isArray(currentState.metadataJson)
          ? (currentState.metadataJson as Record<string, unknown>)
          : {}
      await prisma.conversationState.update({
        where: { conversationId: conversation.id },
        data: {
          metadataJson: {
            ...currentMeta,
            hasUnsubscribeLink: true,
            unsubscribeUrl: unsubInfo.unsubscribeUrl,
          } as Prisma.InputJsonValue,
        },
      })
    }
  }
```

- [ ] **Step 6: Create unsubscribe API route**

```typescript
// app/api/conversations/[id]/unsubscribe/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
    select: { id: true, tenantId: true },
  })
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const state = await prisma.conversationState.findUnique({
    where: { conversationId: params.id },
    select: { metadataJson: true },
  })
  const meta =
    state?.metadataJson && typeof state.metadataJson === "object" && !Array.isArray(state.metadataJson)
      ? (state.metadataJson as Record<string, unknown>)
      : {}
  const unsubscribeUrl = typeof meta.unsubscribeUrl === "string" ? meta.unsubscribeUrl : null

  if (unsubscribeUrl) {
    // Fire-and-forget GET request to unsubscribe URL
    fetch(unsubscribeUrl, { method: "GET" }).catch(() => {/* ignore errors */})
  }

  // Close the conversation and log
  await prisma.conversation.update({
    where: { id: params.id },
    data: { status: "closed" },
  })
  await prisma.auditLog.create({
    data: {
      tenantId: conversation.tenantId,
      action: "conversation.unsubscribed",
      payloadJson: { conversationId: params.id, unsubscribeUrl },
    },
  })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 7: Add Unsubscribe button to conversation page**

Create `app/conversations/[id]/UnsubscribeButton.tsx`:

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function UnsubscribeButton({ conversationId }: { conversationId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleUnsubscribe() {
    if (!confirm("Unsubscribe and archive this conversation?")) return
    setLoading(true)
    await fetch(`/api/conversations/${conversationId}/unsubscribe`, { method: "POST" })
    setDone(true)
    router.refresh()
  }

  if (done) return <span className="text-xs text-slate-400">Unsubscribed ✓</span>

  return (
    <button
      onClick={handleUnsubscribe}
      disabled={loading}
      className="rounded border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
    >
      {loading ? "Unsubscribing…" : "Unsubscribe & Archive"}
    </button>
  )
}
```

In `app/conversations/[id]/page.tsx`, pull `hasUnsubscribeLink` from the state metadata and conditionally render the button in the action bar area.

- [ ] **Step 8: Run full test suite**

```bash
npm test
```
Expected: all tests PASS

- [ ] **Step 9: Commit**

```bash
git add lib/agent/unsubscribe.ts tests/unsubscribe.test.ts app/api/conversations/[id]/unsubscribe/ app/conversations/[id]/UnsubscribeButton.tsx lib/agent/work-item-sync.ts app/conversations/[id]/page.tsx
git commit -m "feat: add unsubscribe detection, API route, and Unsubscribe button on conversation page"
```

---

## Final v3.0 Verification

- [ ] Start dev server: `npm run dev`
- [ ] Navigate to `/settings` — confirm "VIP Contacts" section visible, can add/remove contacts
- [ ] Add your own email as a VIP; trigger a Gmail sync; confirm the synced conversation shows ⭐ in inbox and VIP banner on conversation page
- [ ] Open a known marketing email; confirm "Unsubscribe & Archive" button visible
- [ ] Check `/inbox?attention=life_admin` shows life admin conversations
- [ ] Confirm test suite still passes: `npm test`
