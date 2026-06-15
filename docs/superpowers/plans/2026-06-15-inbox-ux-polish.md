# Inbox UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six focused UX issues in the FlowDesk inbox: compact composer, scroll preservation, read/unread styling, email width, correct CTA link extraction, and OTP copy button.

**Architecture:** Backend-first on the two logic changes (URL extraction, detectedCode persistence), then client UI changes. No new routes or schema migrations — all detectedCode storage uses the existing `metadataJson` JSON blob. The scroll container is extracted to a thin `"use client"` island so `AppListColumn` stays a Server Component.

**Tech Stack:** Next.js 14 (App Router), React, TypeScript, Tailwind CSS, Prisma, Vitest

**Spec:** `docs/superpowers/specs/2026-06-15-inbox-ux-polish-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/agent/email-classifier.ts` | Modify | Replace `extractActionLink` with scored `extractBestActionLink` |
| `lib/agent/work-item-sync.ts` | Modify | Persist `detectedCode` alongside `hasDetectedCode` |
| `lib/agent/command-center.ts` | Modify | Add `detectedCode?: string` to type + `getActionMetadata` mapping |
| `app/components/NeedsActionSection.tsx` | Modify | Show OTP code pill + copy button when `detectedCode` present |
| `app/conversations/[id]/ReplyComposer.tsx` | Modify | Expand-on-focus textarea (2→5 rows) |
| `app/components/InboxScrollContainer.tsx` | Create | Client island: saves/restores scroll to sessionStorage |
| `app/components/AppListColumn.tsx` | Modify | Use `InboxScrollContainer`; 3-tier read/unread styling |
| `app/conversations/[id]/page.tsx` | Modify | Remove email content width constraint; reduce padding |
| `tests/email-classifier.test.ts` | Modify | Add tests for `extractBestActionLink` behaviour |
| `tests/work-item-sync.test.ts` | Modify | Assert `detectedCode` is persisted |
| `tests/command-center.test.ts` | Modify | Assert `detectedCode` flows through `getActionMetadata` |

---

## Task 1: Replace `extractActionLink` with `extractBestActionLink`

**Files:**
- Modify: `lib/agent/email-classifier.ts`
- Modify: `tests/email-classifier.test.ts`

The current `extractActionLink` returns the first URL in the body, which is often a tracking pixel or unsubscribe link in HTML emails. Replace it with a scored selector.

- [ ] **Step 1: Add failing tests for the new function behaviour**

Add the following tests to the bottom of the `describe("classifyEmailType", ...)` block in `tests/email-classifier.test.ts`. The existing tests must continue to pass — these add new coverage for the scoring behaviour.

```typescript
  it("picks the reset link over an unsubscribe link that appears first in the body", () => {
    const result = classifyEmailType({
      fromEmail: "noreply@service.com",
      subject: "Reset your password",
      body: [
        "Click here to unsubscribe: https://service.com/unsubscribe?uid=abc",
        "Reset your password: https://service.com/reset-password?token=xyz123abc",
      ].join("\n"),
    })
    expect(result.action?.actionLink).toBe("https://service.com/reset-password?token=xyz123abc")
  })

  it("picks the verify link over a tracking pixel URL that appears first", () => {
    const result = classifyEmailType({
      fromEmail: "accounts@app.com",
      subject: "Verify your email",
      body: [
        "https://track.app.com/pixel?uid=1234",
        "Verify your email: https://app.com/verify?token=abcdef",
      ].join("\n"),
    })
    expect(result.action?.actionLink).toBe("https://app.com/verify?token=abcdef")
  })

  it("returns undefined actionLink when only tracking/unsubscribe URLs are present", () => {
    const result = classifyEmailType({
      fromEmail: "noreply@service.com",
      subject: "Reset your password",
      body: "Reset your password.\nhttps://service.com/unsubscribe?uid=abc\nhttps://track.service.com/pixel?open=1",
    })
    // No good CTA link available — should not surface a download or tracking URL
    expect(result.action?.actionLink).toBeUndefined()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/email-classifier.test.ts
```

Expected: the two new "picks" tests fail; the "returns undefined" test may pass or fail depending on current behaviour.

- [ ] **Step 3: Replace `extractActionLink` with `extractBestActionLink` in `lib/agent/email-classifier.ts`**

Find and replace the existing `extractActionLink` function (line ~180):

```typescript
// REMOVE this:
function extractActionLink(text: string): string | undefined {
  return text.match(URL_PATTERN)?.[0]?.replace(/[.,;:!?]+$/, "")
}
```

Replace with:

```typescript
const DISCARD_URL_PATTERNS = [
  /unsubscribe/i,
  /\bunsub\b/i,
  /opt[_-]?out/i,
  /\/pixel[/?]/i,
  /\/track[/?]/i,
  /[?&]utm_/i,
  /\/open[/?]/i,
  /\/click[/?]/i,
  /linkedin\.com/i,
  /twitter\.com/i,
  /facebook\.com/i,
  /instagram\.com/i,
]

const CTA_ACTION_KEYWORDS = [
  "reset", "verify", "confirm", "activate", "create-password",
  "set-password", "choose-password", "signup", "sign-up", "magic",
  "token", "validate", "complete", "account/setup", "account/confirm",
  "approve", "authorize",
]

const CTA_TYPE_KEYWORDS: Record<string, string[]> = {
  reset_password: ["reset", "password"],
  create_password: ["create-password", "set-password", "choose-password"],
  verify_email: ["verify", "confirm", "validate", "activate"],
  confirm_account: ["confirm", "activate", "complete"],
  account_setup: ["setup", "activate", "complete"],
  login_approval: ["approve", "authorize", "login", "signin"],
  magic_link: ["magic", "login", "signin"],
}

function extractBestActionLink(text: string, actionType?: string): string | undefined {
  const allUrls = Array.from(text.matchAll(/\bhttps?:\/\/[^\s<>"')]+/gi))
    .map((m) => m[0].replace(/[.,;:!?]+$/, ""))
    .filter((url) => url.length >= 20)

  const candidates = allUrls.filter(
    (url) => !DISCARD_URL_PATTERNS.some((p) => p.test(url))
  )

  if (candidates.length === 0) return undefined
  if (candidates.length === 1) return candidates[0]

  const typeKeywords = actionType ? (CTA_TYPE_KEYWORDS[actionType] ?? []) : []

  const scored = candidates.map((url) => {
    const lower = url.toLowerCase()
    let score = 0
    if (typeKeywords.some((k) => lower.includes(k))) score += 3
    if (CTA_ACTION_KEYWORDS.some((k) => lower.includes(k))) score += 2
    const pathOnly = lower.split("?")[0]
    if (pathOnly.length > 40) score += 1
    return { url, score }
  })

  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]

  // If even the best candidate has no CTA signals, return undefined rather
  // than surface a generic/unknown link.
  if (best.score === 0 && candidates.length > 1) return undefined

  return best.url
}
```

- [ ] **Step 4: Update all callers of the old `extractActionLink` to use `extractBestActionLink`**

In `lib/agent/email-classifier.ts`, there are 4 call sites. Replace each one, passing the `actionType` where available:

```typescript
// Line ~219 (LOGIN_APPROVAL_PATTERN branch):
// BEFORE: const actionLink = extractActionLink(text)
const actionLink = extractBestActionLink(text, "login_approval")

// Line ~233 (PASSWORD_ACTION_PATTERN branch):
// BEFORE: const actionLink = extractActionLink(text)
//         const type = passwordActionType(text)
const type = passwordActionType(text)
const actionLink = extractBestActionLink(text, type)

// Line ~248 (VERIFY_ACCOUNT_PATTERN branch):
// BEFORE: const actionLink = extractActionLink(text)
//         const type = verificationActionType(text)
const type = verificationActionType(text)
const actionLink = extractBestActionLink(text, type)

// Line ~270 (SECURITY_REVIEW_PATTERN branch):
// BEFORE: ...(extractActionLink(text) ? { actionLink: extractActionLink(text) } : {})
const securityLink = extractBestActionLink(text, "security_alert")
// then use: ...(securityLink ? { actionLink: securityLink } : {})
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/email-classifier.test.ts
```

Expected: all tests pass including the 3 new ones.

- [ ] **Step 6: Run the full test suite to check for regressions**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/agent/email-classifier.ts tests/email-classifier.test.ts
git commit -m "fix: replace extractActionLink with scored extractBestActionLink to pick correct CTA URLs"
```

---

## Task 2: Persist `detectedCode` and propagate through types

**Files:**
- Modify: `lib/agent/work-item-sync.ts` (around line 383)
- Modify: `lib/agent/command-center.ts` (type at line ~102, mapping at line ~308)
- Modify: `tests/work-item-sync.test.ts`
- Modify: `tests/command-center.test.ts`

- [ ] **Step 1: Write a failing test for `detectedCode` persistence in `tests/work-item-sync.test.ts`**

Find an existing test that exercises the OTP / `needs_action` path in `work-item-sync.test.ts`. Add this test alongside it:

```typescript
it("persists detectedCode in the action metadata when the email contains an OTP", async () => {
  mockTenantFindUnique.mockResolvedValue({ accountType: "personal" })
  mockConversationFindFirst.mockResolvedValue({
    ...conversation,
    messages: [
      {
        ...conversation.messages[0],
        direction: "inbound",
        body: "Your verification code is 847291. This code expires in 10 minutes.",
      },
    ],
  })
  mockStateFindUnique.mockResolvedValue(null)
  mockStateUpsert.mockResolvedValue({})
  mockStateUpdate.mockResolvedValue({})
  mockTaskUpsert.mockResolvedValue({})
  mockLeadFindFirst.mockResolvedValue(null)
  mockLeadUpsert.mockResolvedValue({})
  mockAuditCreate.mockResolvedValue({})
  mockKbDocFindMany.mockResolvedValue([])

  await syncConversationWorkItems({
    tenantId: "tenant-1",
    conversationId: "conv-1",
  })

  const updateCall = mockStateUpdate.mock.calls.find(
    (c) => c[0]?.data?.metadataJson?.action?.type === "otp_code"
  )
  expect(updateCall).toBeDefined()
  const action = updateCall![0].data.metadataJson.action
  expect(action.hasDetectedCode).toBe(true)
  expect(action.detectedCode).toBe("847291")
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/work-item-sync.test.ts
```

Expected: FAIL — `action.detectedCode` is `undefined`.

- [ ] **Step 3: Update `work-item-sync.ts` to persist `detectedCode`**

Locate the `persistedAction` object around line 383 in `lib/agent/work-item-sync.ts`. The change is one added line:

```typescript
// BEFORE:
const persistedAction = action
  ? {
      type: action.type,
      explanation: action.explanation,
      ...(action.actionLink ? { actionLink: action.actionLink } : {}),
      ...(action.expirationText ? { expirationText: action.expirationText } : {}),
      hasDetectedCode: Boolean(action.detectedCode),
    }
  : null

// AFTER:
const persistedAction = action
  ? {
      type: action.type,
      explanation: action.explanation,
      ...(action.actionLink ? { actionLink: action.actionLink } : {}),
      ...(action.expirationText ? { expirationText: action.expirationText } : {}),
      hasDetectedCode: Boolean(action.detectedCode),
      ...(action.detectedCode ? { detectedCode: action.detectedCode } : {}),
    }
  : null
```

- [ ] **Step 4: Run work-item-sync tests to verify they pass**

```bash
npx vitest run tests/work-item-sync.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Write a failing test for `detectedCode` in the command-center type mapping**

Add to `tests/command-center.test.ts` inside the existing `describe` block:

```typescript
it("surfaces detectedCode from conversationState action metadata", () => {
  const conv = conversation({
    conversationState: {
      metadataJson: {
        attentionCategory: "needs_action",
        attentionReason: "OTP required",
        action: {
          type: "otp_code",
          explanation: "Use the one-time code only in the service that requested it.",
          hasDetectedCode: true,
          detectedCode: "847291",
        },
      },
    },
  })
  const result = analyzeConversationForCommandCenter(conv, now)
  expect(result.action?.hasDetectedCode).toBe(true)
  expect(result.action?.detectedCode).toBe("847291")
})
```

- [ ] **Step 6: Run test to verify it fails**

```bash
npx vitest run tests/command-center.test.ts
```

Expected: FAIL — `result.action?.detectedCode` is `undefined`.

- [ ] **Step 7: Add `detectedCode` to the type and mapping in `lib/agent/command-center.ts`**

**Part A — update the type** (around line 102):

```typescript
// BEFORE:
  action: {
    type: string
    explanation: string
    actionLink?: string
    expirationText?: string
    hasDetectedCode?: boolean
  } | null

// AFTER:
  action: {
    type: string
    explanation: string
    actionLink?: string
    expirationText?: string
    hasDetectedCode?: boolean
    detectedCode?: string
  } | null
```

**Part B — update `getActionMetadata`** (around line 308, inside the `return` object):

```typescript
// BEFORE:
  return {
    type,
    explanation,
    ...(typeof record.actionLink === "string" ? { actionLink: record.actionLink } : {}),
    ...(typeof record.expirationText === "string" ? { expirationText: record.expirationText } : {}),
    ...(typeof record.hasDetectedCode === "boolean" ? { hasDetectedCode: record.hasDetectedCode } : {}),
  }

// AFTER:
  return {
    type,
    explanation,
    ...(typeof record.actionLink === "string" ? { actionLink: record.actionLink } : {}),
    ...(typeof record.expirationText === "string" ? { expirationText: record.expirationText } : {}),
    ...(typeof record.hasDetectedCode === "boolean" ? { hasDetectedCode: record.hasDetectedCode } : {}),
    ...(typeof record.detectedCode === "string" ? { detectedCode: record.detectedCode } : {}),
  }
```

- [ ] **Step 8: Run command-center tests to verify they pass**

```bash
npx vitest run tests/command-center.test.ts
```

Expected: all tests pass.

- [ ] **Step 9: Run the full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add lib/agent/work-item-sync.ts lib/agent/command-center.ts tests/work-item-sync.test.ts tests/command-center.test.ts
git commit -m "feat: persist detectedCode in conversationState and propagate through command-center types"
```

---

## Task 3: OTP Copy Button in NeedsActionSection

**Files:**
- Modify: `app/components/NeedsActionSection.tsx`

This is a pure UI change. `action.detectedCode` is now available from Task 2. We show it in a monospace pill and add a "Copy" button with a transient "Copied!" flash. No server calls, no logging.

- [ ] **Step 1: Add `detectedCode` display and copy button to `NeedsActionSection.tsx`**

Replace the entire `NeedsActionCard` component (lines 27–91) with:

```typescript
function NeedsActionCard({ item }: { item: CommandCenterConversation }) {
  const router = useRouter()
  const action = item.action
  const [copied, setCopied] = useState(false)

  function openCard() {
    router.push(item.href)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      openCard()
    }
  }

  function copyCode(event: React.MouseEvent, code: string) {
    event.stopPropagation()
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 500)
    })
  }

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={openCard}
      onKeyDown={handleKeyDown}
      aria-label={`Open ${item.displayName}`}
      className={`cursor-pointer flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-2.5 transition hover:bg-amber-50 hover:border-amber-300 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-400 ${item.isRead ? "" : "ring-1 ring-amber-200"}`}
    >
      <div className="flex-1 min-w-0">
        <p className={`text-[11px] text-amber-900 ${item.isRead ? "font-medium" : "font-semibold"}`}>
          {item.displayName}
        </p>
        <p className="text-[11px] text-amber-800 truncate">{item.nextAction}</p>
        {item.reason && (
          <p className="text-[10px] text-amber-600 italic mt-0.5 truncate">{item.reason}</p>
        )}

        {/* Action metadata */}
        {action && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {action.detectedCode ? (
              <>
                <span className="font-mono text-sm bg-violet-50 border border-violet-200 text-violet-900 px-2 py-0.5 rounded">
                  {action.detectedCode}
                </span>
                <button
                  type="button"
                  onClick={(e) => copyCode(e, action.detectedCode!)}
                  className="text-[10px] font-semibold text-violet-700 hover:text-violet-900 transition"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </>
            ) : action.hasDetectedCode ? (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                Code detected
              </span>
            ) : (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-200 text-amber-800">
                {actionLabel(action.type)}
              </span>
            )}
            {action.expirationText && (
              <span className="text-[10px] text-red-600 font-medium">⏱ {action.expirationText}</span>
            )}
            {action.actionLink && (
              <a
                href={action.actionLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-600 text-white hover:bg-amber-700 transition"
              >
                Open link →
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

Also add `useState` to the import at the top of the file (it already imports `useRouter` from `"next/navigation"`):

```typescript
import { useRouter } from "next/navigation"
import { useState } from "react"
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/NeedsActionSection.tsx
git commit -m "feat: show OTP code in needs-action card with copy button"
```

---

## Task 4: Compact Reply Composer

**Files:**
- Modify: `app/conversations/[id]/ReplyComposer.tsx`

- [ ] **Step 1: Add `isFocused` state and update textarea in `ReplyComposer.tsx`**

Add `isFocused` to the existing state declarations (around line 42):

```typescript
const [isFocused, setIsFocused] = useState(false)
```

Update the `<textarea>` element (around line 199). Change:

```typescript
// BEFORE:
<textarea
  value={text}
  onChange={(e) => setText(e.target.value)}
  rows={hasDraftText ? 6 : 4}
  placeholder={...}
  className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm leading-relaxed text-slate-900 focus:border-slate-400 focus:outline-none disabled:bg-slate-50"
  disabled={isBusy}
/>

// AFTER:
<textarea
  value={text}
  onChange={(e) => setText(e.target.value)}
  onFocus={() => setIsFocused(true)}
  onBlur={() => { if (!hasDraftText) setIsFocused(false) }}
  rows={isFocused || hasDraftText ? 5 : 2}
  placeholder={canAI ? "Type a reply, or add an instruction below and click Draft with AI…" : "Type your reply…"}
  className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm leading-relaxed text-slate-900 focus:border-slate-400 focus:outline-none disabled:bg-slate-50"
  disabled={isBusy}
/>
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/conversations/[id]/ReplyComposer.tsx
git commit -m "feat: compact reply composer — collapses to 2 rows by default, expands on focus"
```

---

## Task 5: Inbox Scroll Preservation

**Files:**
- Create: `app/components/InboxScrollContainer.tsx`
- Modify: `app/components/AppListColumn.tsx`

`AppListColumn` is a Server Component, so we can't add `useEffect` directly. Instead we create a thin `"use client"` wrapper for the scrollable list div.

- [ ] **Step 1: Create `app/components/InboxScrollContainer.tsx`**

```typescript
"use client"

import { useEffect, useRef, type ReactNode } from "react"

interface Props {
  scrollKey: string
  children: ReactNode
  className?: string
}

export default function InboxScrollContainer({ scrollKey, children, className }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const storageKey = `flowdesk.inbox.scroll.${scrollKey}`

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const saved = sessionStorage.getItem(storageKey)
    if (saved !== null) {
      el.scrollTop = Number(saved)
    }

    function onScroll() {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        sessionStorage.setItem(storageKey, String(el!.scrollTop))
      }, 200)
    }

    el.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      el.removeEventListener("scroll", onScroll)
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [storageKey])

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Import and use `InboxScrollContainer` in `AppListColumn.tsx`**

At the top of `app/components/AppListColumn.tsx`, add the import after the existing imports:

```typescript
import InboxScrollContainer from "@/app/components/InboxScrollContainer"
```

Build the `scrollKey` string from the current filter params. Add this just before the `return` statement (around line 165):

```typescript
  const scrollKey = [status ?? "all", q ?? "", sales ? "s" : ""].join("_")
```

Replace the existing scroll container div (around line 216):

```typescript
// BEFORE:
<div className="flex-1 overflow-y-auto">

// AFTER:
<InboxScrollContainer scrollKey={scrollKey} className="flex-1 overflow-y-auto">
```

And its closing tag:

```typescript
// BEFORE:
</div>  {/* closes the conversations list */}

// AFTER:
</InboxScrollContainer>
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run the test suite**

```bash
npx vitest run
```

Expected: all tests pass (no tests cover the scroll container directly — it's a browser behaviour).

- [ ] **Step 5: Commit**

```bash
git add app/components/InboxScrollContainer.tsx app/components/AppListColumn.tsx
git commit -m "feat: preserve inbox scroll position using sessionStorage client island"
```

---

## Task 6: Read/Unread 3-Tier Visual Treatment

**Files:**
- Modify: `app/components/AppListColumn.tsx`

The `ConvRow` type already includes `readAt: Date | null`. We derive `isRead` and use it alongside the existing `isUnread` to apply three distinct visual tiers.

- [ ] **Step 1: Add `isRead` derived boolean and update the row styling in `AppListColumn.tsx`**

Inside the `conversations.map((conv) => {` callback (around line 222), add `isRead` after the existing `isUnread` line:

```typescript
const isUnread = !conv.readAt && conv.gmailUnread !== false && !fyi
const isRead = !!conv.readAt
```

Update the name `<p>` element's `className` (around line 253). Replace:

```typescript
// BEFORE:
className={`min-w-0 truncate text-xs ${
  isUnread
    ? "font-bold text-slate-900"
    : fyi
      ? "font-normal text-slate-500"
      : "font-medium text-slate-700"
}`}

// AFTER:
className={`min-w-0 truncate text-xs ${
  isUnread
    ? "font-bold text-slate-900"
    : fyi
      ? "font-normal text-slate-400"
      : isRead && conv.status !== "needs_reply"
        ? "font-medium text-slate-500"
        : "font-semibold text-slate-800"
}`}
```

Update the row `Link` hover background to add a subtle blue tint for unread rows. Replace the existing `className` on the `<Link>` (around line 241):

```typescript
// BEFORE:
className={`block border-b border-slate-50 px-3 py-2.5 transition ${
  isSelected
    ? "border-l-2 border-l-blue-500 bg-blue-50"
    : "hover:bg-slate-50"
} ${fyi ? "opacity-40" : ""}`}

// AFTER:
className={`block border-b border-slate-50 px-3 py-2.5 transition ${
  isSelected
    ? "border-l-2 border-l-blue-500 bg-blue-50"
    : isUnread
      ? "hover:bg-blue-50/60"
      : "hover:bg-slate-50"
} ${fyi ? "opacity-40" : ""}`}
```

Update the snippet text to be slightly more muted when read:

```typescript
// BEFORE (around line 269):
{snippet && (
  <p className="mt-0.5 truncate text-[11px] text-slate-500">{snippet}</p>
)}

// AFTER:
{snippet && (
  <p className={`mt-0.5 truncate text-[11px] ${isUnread ? "text-slate-500" : "text-slate-400"}`}>
    {snippet}
  </p>
)}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/AppListColumn.tsx
git commit -m "feat: 3-tier read/unread visual treatment in inbox list"
```

---

## Task 7: Email Reading Width

**Files:**
- Modify: `app/conversations/[id]/page.tsx`

Two changes: reduce the outer scrollable div padding, remove the `max-w-3xl` constraint from the messages container. On mobile, reduce article padding.

- [ ] **Step 1: Update the desktop email thread layout in `app/conversations/[id]/page.tsx`**

Find the `{/* Scrollable messages */}` comment (around line 557). Update the outer div and inner container:

```typescript
// BEFORE:
<div className="flex-1 overflow-y-auto px-5 py-4">
  <div className="mx-auto max-w-3xl space-y-4">

// AFTER:
<div className="flex-1 overflow-y-auto px-3 py-4">
  <div className="space-y-4">
```

- [ ] **Step 2: Update the mobile article card padding**

Find the mobile messages section (around line 661) inside `{/* MOBILE LAYOUT */}`. Update the `<article>` tag:

```typescript
// BEFORE:
<article key={message.id} className="px-6 py-5">

// AFTER:
<article key={message.id} className="px-4 py-4">
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/conversations/[id]/page.tsx
git commit -m "fix: reduce email reading padding and remove max-width constraint on desktop"
```

---

## Task 8: Final Verification

- [ ] **Step 1: Run the full test suite one final time**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 2: Manual QA checklist**

Open the app with `npm run dev` and verify:

- [ ] Inbox list: reply composer starts at 2 rows; expands to 5 on click inside the textarea
- [ ] Inbox list: clicking away from an empty composer collapses it back to 2 rows
- [ ] AI draft pre-loaded: composer starts expanded (text present)
- [ ] "Draft with AI" and "Send" buttons are always visible regardless of composer state
- [ ] Scroll down the inbox list; open a conversation; press browser back or navigate back to `/inbox` — list scrolls to the previous position
- [ ] Change the filter (e.g. All → Reply); scroll resets (expected)
- [ ] Unread email: **bold** name + blue dot
- [ ] Read email with `needs_reply` status: `font-semibold text-slate-800` + red status dot still visible
- [ ] Read email with `closed`/`in_progress`: muted `text-slate-500`
- [ ] FYI/quiet email: `opacity-40` as before
- [ ] Desktop email body: content fills more of the center column (less wasted side padding)
- [ ] HTML email does not overflow horizontally
- [ ] On a password-reset / verify-email Needs Action card: "Open link" opens the CTA URL in a new tab, not the unsubscribe link
- [ ] On an OTP Needs Action card where `detectedCode` is present: code shown in monospace pill
- [ ] "Copy" button copies the code; button shows "Copied!" for ~500ms
- [ ] Verifying no `console.log` output for the code in browser DevTools
