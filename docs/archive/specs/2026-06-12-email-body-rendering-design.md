# Email Body Rendering — Design Spec

**Date:** 2026-06-12  
**Status:** Approved

---

## Problem

The conversation detail page renders `message.body` as plain text unconditionally. Three distinct failure modes result:

1. **Raw HTML displayed as literal text.** Gmail's `extractBody` function reads `payload.body?.data` without checking `mimeType`. Single-part HTML-only emails (e.g. Azure transactional emails) get stored as raw HTML in the `body` column. The UI then shows `<!DOCTYPE html PUBLIC ...>` and embedded CSS as visible text.

2. **URLs are not clickable.** Plain-text emails containing URLs (e.g. Google Docs share links) render as inert text — no anchor tags, no `target="_blank"`.

3. **Long content breaks the layout.** Long URLs and raw HTML strings overflow the email card, create a page-level horizontal scrollbar, and push the right-side sidebar (Contact / Label / Assistant Context) off-screen because the main grid column has no `min-width: 0`.

---

## Root Cause Map

| Location | Issue |
|---|---|
| `lib/google.ts:126-128` | `extractBody` reads `payload.body?.data` directly without checking `mimeType` — HTML-only single-part emails stored as raw HTML |
| `app/conversations/[id]/page.tsx:263` | `<p>{message.body}</p>` — no detection, no sanitization, no linkification |
| `app/conversations/[id]/page.tsx:243` | Main grid section has no `min-width: 0`, causing overflow to push sidebar off-screen |

`lib/microsoft.ts` is not affected — it already strips HTML via `stripHtml()` before storing.

---

## Approach: Fix Both Source and Render

Fix `extractBody` so future syncs never store raw HTML **and** build a `MessageBody` component that handles whatever is currently in the DB (existing rows, edge cases, future email types).

---

## Component Design

### 1. Fix `lib/google.ts` — `extractBody`

**Current behavior:** Returns `payload.body?.data` decoded directly without a mimeType check.

**New behavior:**
- Check the top-level `mimeType` before using `payload.body?.data`.
- If `mimeType` is `text/plain` (or absent/unknown), return the decoded content as-is.
- If `mimeType` is `text/html`, strip tags before returning.
- Recurse into nested `multipart/*` parts (currently only one level deep).
- Maintain existing priority: text/plain > text/html (stripped).

This ensures `body` in the DB always contains clean plain text going forward.

### 2. New `app/components/EmailBody.tsx` — Server Component

A focused server component responsible for safe email body rendering. Not a client component — sanitization happens server-side, no DOM dependency needed.

**Interface:**
```ts
function EmailBody({ body }: { body: string }): JSX.Element
```

**Detection heuristic — is the body HTML?**
```
body.trimStart().startsWith('<')
```
This covers `<!DOCTYPE`, `<html`, `<div`, `<p>` etc. False positives (a plain-text email starting with `<`) get sanitized harmlessly — the sanitizer removes all tags so it degrades to readable text.

**HTML path:**
1. Sanitize with `sanitize-html` using a permissive-but-safe allow-list:
   - Allowed tags: common formatting tags (`p`, `br`, `b`, `i`, `u`, `strong`, `em`, `a`, `ul`, `ol`, `li`, `table`, `thead`, `tbody`, `tr`, `td`, `th`, `h1`–`h6`, `div`, `span`, `img`, `pre`, `code`, `blockquote`, `hr`)
   - Allowed attributes on `a`: `href`, `title` — `target` and `rel` enforced to `_blank` / `noopener noreferrer`
   - Allowed attributes on `img`: `src`, `alt`, `width`, `height` — no `onerror`, no `onload`
   - Strip all `style` attributes (prevent CSS injection / layout breakage)
   - Strip all `script`, `iframe`, `object`, `embed`, `form`, `input`, `button` tags entirely
2. Render sanitized HTML via `dangerouslySetInnerHTML`.
3. Wrap in a `div.email-body` with scoped CSS.

**Plain-text path:**
1. Escape any HTML special characters (`&`, `<`, `>`, `"`) to prevent XSS.
2. Replace `\n` with `<br>`.
3. Auto-link URLs: match `https?://[^\s<>"]+` → `<a href="$url" target="_blank" rel="noopener noreferrer">$url</a>`.
4. Render via `dangerouslySetInnerHTML` (safe — input is escaped then only safe tags added).

**CSS applied to `.email-body` wrapper:**
```css
overflow-wrap: anywhere;
word-break: break-word;
max-width: 100%;

img { max-width: 100%; height: auto; }

table { max-width: 100%; table-layout: fixed; overflow-x: auto; display: block; }

pre, code { white-space: pre-wrap; overflow-wrap: anywhere; }

a { color: #2563eb; text-decoration: underline; }
```

### 3. Layout Fix — `app/conversations/[id]/page.tsx`

**Line 244 — main `<section>`:** Add `min-w-0 overflow-hidden` classes so the CSS grid column can shrink correctly.

**Line 257 — message bubble `div`:** Change `max-w-[75%]` wrapper to also carry `min-w-0` and replace inner `<p>` with `<EmailBody body={message.body} />`.

The outer grid (`lg:grid-cols-[1fr_280px]`) already expresses the right intent — the sidebar width is fixed at 280px and the main column is `1fr`. Adding `min-w-0` to the main section prevents the `1fr` column from expanding beyond the available space when content overflows.

---

## Package

**`sanitize-html`** (+ `@types/sanitize-html`)

- Pure Node.js — no DOM/jsdom required, works in server components and tests
- Granular allow-list: explicit tag + attribute control
- Well-maintained, widely used for exactly this use case
- ~150kB, tree-shakeable

---

## Tests — `tests/email-body.test.ts`

Unit tests using Vitest (existing test environment: `node`):

| Test | Description |
|---|---|
| HTML detection | Body starting with `<!DOCTYPE` is detected as HTML |
| HTML detection | Body starting with `<div` is detected as HTML |
| Plain text detection | Body with no leading `<` is treated as plain text |
| Sanitization — script removal | `<script>alert(1)</script>` is stripped from output |
| Sanitization — event handlers | `<img onerror="xss()">` attribute removed |
| Sanitization — iframe removal | `<iframe src="...">` tag removed entirely |
| Link safety | `<a href="...">` gets `target="_blank"` and `rel="noopener noreferrer"` enforced |
| Linkification | Plain-text `https://example.com` becomes `<a href=...>` |
| Linkification | Non-URL plain text is unchanged |
| Line breaks | `\n` in plain text becomes `<br>` |
| Layout — long URL | Long URL in plain text wraps; no test for visual overflow but `overflow-wrap` confirmed in output |

Tests exercise the sanitization/linkification logic as pure functions — no React rendering required.

---

## File Change Summary

| File | Change |
|---|---|
| `lib/google.ts` | Fix `extractBody` to check mimeType; recurse into nested multipart |
| `app/components/EmailBody.tsx` | New server component — HTML detection, sanitization, linkification |
| `app/conversations/[id]/page.tsx` | Use `EmailBody`; add `min-w-0 overflow-hidden` to main section |
| `tests/email-body.test.ts` | New unit test file |
| `package.json` | Add `sanitize-html`, `@types/sanitize-html` |

---

## Acceptance Criteria

- HTML emails (Azure, marketing, transactional) render as readable content, not `<!DOCTYPE` markup.
- Google Docs share URLs display as clickable links opening in a new tab.
- Long URLs wrap inside the email card — no page-level horizontal scrollbar.
- The right sidebar remains fully visible on desktop even with long/HTML email content.
- No XSS: `<script>` tags, event handlers, and unsafe attributes are removed before render.
- All new tests pass; existing test suite unaffected.
