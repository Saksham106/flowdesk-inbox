# Email Body Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the conversation detail page to render HTML emails as readable content, auto-link plain-text URLs, and prevent email body overflow from breaking the sidebar layout.

**Architecture:** Extract a pure `lib/email-body.ts` module with testable functions (HTML detection, sanitization, linkification), wire it into a thin `EmailBody` server component, fix the Gmail `extractBody` bug that lets raw HTML reach the DB, and add `min-w-0` to the grid column so long content can never push the sidebar off-screen.

**Tech Stack:** Next.js 14 App Router (server components), `sanitize-html` (Node.js-safe HTML sanitizer), Tailwind CSS, Vitest

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `lib/email-body.ts` | Create | Pure functions: `isHtmlBody`, `sanitizeEmailHtml`, `linkifyText`, `renderEmailBodyHtml` |
| `app/components/EmailBody.tsx` | Create | Server component that renders output of `renderEmailBodyHtml` |
| `app/globals.css` | Modify | Add `.email-body` scoped CSS for overflow, images, tables, links |
| `lib/google.ts` | Modify | Fix `extractBody` to check `mimeType` on root body and recurse into nested multipart |
| `app/conversations/[id]/page.tsx` | Modify | Use `EmailBody`; add `min-w-0 overflow-x-hidden` to main section |
| `tests/email-body.test.ts` | Create | Unit tests for all functions in `lib/email-body.ts` |

---

## Task 1: Install `sanitize-html`

**Files:**
- Modify: `package.json` (via npm)

- [ ] **Step 1: Install the package**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox
npm install sanitize-html @types/sanitize-html
```

Expected: packages added to `node_modules`, `package.json` updated with `"sanitize-html"` in dependencies and `"@types/sanitize-html"` in devDependencies.

- [ ] **Step 2: Verify install**

```bash
node -e "require('sanitize-html'); console.log('ok')"
```

Expected output: `ok`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add sanitize-html dependency"
```

---

## Task 2: Write failing tests for `lib/email-body.ts`

**Files:**
- Create: `tests/email-body.test.ts`

- [ ] **Step 1: Create the test file**

Create `tests/email-body.test.ts` with this content:

```typescript
import { describe, it, expect } from "vitest";
import {
  isHtmlBody,
  sanitizeEmailHtml,
  linkifyText,
  renderEmailBodyHtml,
} from "@/lib/email-body";

describe("isHtmlBody", () => {
  it("detects DOCTYPE as HTML", () => {
    expect(isHtmlBody('<!DOCTYPE html PUBLIC "-//W3C//DTD...">')).toBe(true);
  });

  it("detects opening div tag as HTML", () => {
    expect(isHtmlBody("<div>hello</div>")).toBe(true);
  });

  it("detects html tag as HTML", () => {
    expect(isHtmlBody("<html><body>hi</body></html>")).toBe(true);
  });

  it("treats plain text as not HTML", () => {
    expect(isHtmlBody("Hello, here is your Google Doc link")).toBe(false);
  });

  it("treats empty string as not HTML", () => {
    expect(isHtmlBody("")).toBe(false);
  });

  it("ignores leading whitespace when detecting HTML", () => {
    expect(isHtmlBody("  \n<!DOCTYPE html>")).toBe(true);
  });
});

describe("sanitizeEmailHtml", () => {
  it("strips script tags entirely", () => {
    const result = sanitizeEmailHtml("<p>Hello</p><script>alert(1)</script>");
    expect(result).not.toContain("<script");
    expect(result).not.toContain("alert(1)");
    expect(result).toContain("Hello");
  });

  it("strips event handler attributes", () => {
    const result = sanitizeEmailHtml('<img src="x.jpg" onerror="xss()">');
    expect(result).not.toContain("onerror");
  });

  it("strips iframe tags", () => {
    const result = sanitizeEmailHtml(
      '<p>text</p><iframe src="https://evil.com"></iframe>'
    );
    expect(result).not.toContain("<iframe");
  });

  it("enforces target=_blank on links", () => {
    const result = sanitizeEmailHtml(
      '<a href="https://example.com">click</a>'
    );
    expect(result).toContain('target="_blank"');
  });

  it("enforces rel=noopener noreferrer on links", () => {
    const result = sanitizeEmailHtml(
      '<a href="https://example.com">click</a>'
    );
    expect(result).toContain('rel="noopener noreferrer"');
  });

  it("preserves safe formatting tags", () => {
    const result = sanitizeEmailHtml("<p><strong>Bold</strong> and <em>italic</em></p>");
    expect(result).toContain("<strong>Bold</strong>");
    expect(result).toContain("<em>italic</em>");
  });

  it("preserves anchor href attribute", () => {
    const result = sanitizeEmailHtml(
      '<a href="https://docs.google.com/abc">open doc</a>'
    );
    expect(result).toContain('href="https://docs.google.com/abc"');
  });
});

describe("linkifyText", () => {
  it("converts https URLs to anchor tags", () => {
    const result = linkifyText("Check this: https://example.com today");
    expect(result).toContain('<a href="https://example.com"');
  });

  it("opens links in new tab", () => {
    const result = linkifyText("https://example.com");
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener noreferrer"');
  });

  it("does not alter text without URLs", () => {
    const result = linkifyText("Just plain text here");
    expect(result).not.toContain("<a");
    expect(result).toContain("Just plain text here");
  });

  it("converts newlines to <br>", () => {
    const result = linkifyText("Line 1\nLine 2");
    expect(result).toContain("<br>");
    expect(result).not.toContain("\n");
  });

  it("escapes < and > characters", () => {
    const result = linkifyText("Hello <World>");
    expect(result).toContain("&lt;World&gt;");
    expect(result).not.toContain("<World>");
  });

  it("escapes & character", () => {
    const result = linkifyText("cats & dogs");
    expect(result).toContain("&amp;");
  });

  it("escapes double quotes", () => {
    const result = linkifyText('Say "hello"');
    expect(result).toContain("&quot;");
  });
});

describe("renderEmailBodyHtml", () => {
  it("sanitizes HTML bodies (strips script)", () => {
    const result = renderEmailBodyHtml(
      "<p>Hello</p><script>bad()</script>"
    );
    expect(result).not.toContain("<script");
    expect(result).toContain("Hello");
  });

  it("linkifies plain text bodies", () => {
    const result = renderEmailBodyHtml(
      "I've shared an item: https://docs.google.com/document/d/abc"
    );
    expect(result).toContain('<a href="https://docs.google.com/document/d/abc"');
  });

  it("routes DOCTYPE body through HTML sanitizer not linkifier", () => {
    const result = renderEmailBodyHtml(
      '<!DOCTYPE html><html><body><p>Hi</p></body></html>'
    );
    expect(result).toContain("Hi");
    expect(result).not.toContain("DOCTYPE");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/sakshamgoel/Documents/ProjectsInternships/flowdesk-inbox
npx vitest run tests/email-body.test.ts
```

Expected: Multiple failures with `Cannot find module '@/lib/email-body'` or similar. If they pass, something is wrong — stop and investigate.

- [ ] **Step 3: Commit the failing tests**

```bash
git add tests/email-body.test.ts
git commit -m "test: add failing tests for email body rendering"
```

---

## Task 3: Implement `lib/email-body.ts`

**Files:**
- Create: `lib/email-body.ts`

- [ ] **Step 1: Create `lib/email-body.ts`**

```typescript
import sanitizeHtml from "sanitize-html";

export function isHtmlBody(body: string): boolean {
  return body.trimStart().startsWith("<");
}

export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "b", "i", "u", "strong", "em",
      "a", "ul", "ol", "li",
      "table", "thead", "tbody", "tr", "td", "th",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "div", "span", "img", "pre", "code", "blockquote", "hr",
    ],
    allowedAttributes: {
      a: ["href", "title"],
      img: ["src", "alt", "width", "height"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: {
          ...attribs,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
    },
  });
}

const URL_RE = /https?:\/\/[^\s<>"]+/g;

export function linkifyText(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return escaped
    .replace(/\n/g, "<br>")
    .replace(
      URL_RE,
      (url) =>
        `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
    );
}

export function renderEmailBodyHtml(body: string): string {
  if (isHtmlBody(body)) {
    return sanitizeEmailHtml(body);
  }
  return linkifyText(body);
}
```

- [ ] **Step 2: Run the tests — they should pass**

```bash
npx vitest run tests/email-body.test.ts
```

Expected: All tests PASS. If any fail, fix `lib/email-body.ts` until they all pass before continuing.

- [ ] **Step 3: Commit**

```bash
git add lib/email-body.ts
git commit -m "feat: add email body sanitization and linkification utilities"
```

---

## Task 4: Add `.email-body` scoped CSS to `app/globals.css`

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Append the scoped styles**

Add this block to the end of `app/globals.css`:

```css
/* ── Email body rendering ──────────────────────────────────── */
.email-body {
  overflow-wrap: anywhere;
  word-break: break-word;
  max-width: 100%;
}
.email-body img {
  max-width: 100%;
  height: auto;
}
.email-body table {
  max-width: 100%;
  table-layout: fixed;
  overflow-x: auto;
  display: block;
}
.email-body pre,
.email-body code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.email-body a {
  color: #2563eb;
  text-decoration: underline;
}
```

- [ ] **Step 2: Commit**

```bash
git add app/globals.css
git commit -m "style: add email-body scoped CSS for overflow and link styling"
```

---

## Task 5: Create `app/components/EmailBody.tsx`

**Files:**
- Create: `app/components/EmailBody.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { renderEmailBodyHtml } from "@/lib/email-body";

interface Props {
  body: string;
}

export default function EmailBody({ body }: Props) {
  const __html = renderEmailBodyHtml(body);
  return (
    <div
      className="email-body text-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html }}
    />
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors. Fix any type errors before continuing.

- [ ] **Step 3: Commit**

```bash
git add app/components/EmailBody.tsx
git commit -m "feat: add EmailBody server component for safe email rendering"
```

---

## Task 6: Fix `lib/google.ts` — `extractBody` mimeType bug

**Files:**
- Modify: `lib/google.ts:120-141`

- [ ] **Step 1: Replace the `extractBody` function**

Find this block in `lib/google.ts` (lines 120–141):

```typescript
// Extracts the best plain-text body from a Gmail message payload
function extractBody(payload: {
  body?: { data?: string | null } | null;
  parts?: Array<{ mimeType?: string | null; body?: { data?: string | null } | null }> | null;
} | null | undefined): string {
  if (!payload) return "";
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
  }
  const textPart = payload.parts?.find((p) => p.mimeType === "text/plain");
  if (textPart?.body?.data) {
    return Buffer.from(textPart.body.data, "base64url").toString("utf8");
  }
  const htmlPart = payload.parts?.find((p) => p.mimeType === "text/html");
  if (htmlPart?.body?.data) {
    return Buffer.from(htmlPart.body.data, "base64url").toString("utf8")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}
```

Replace it with:

```typescript
type GmailPart = {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: GmailPart[] | null;
};

// Extracts the best plain-text body from a Gmail message payload.
// Prefers text/plain; strips tags from text/html; recurses into multipart.
// Always returns plain text so raw HTML is never stored in the DB.
function extractBody(payload: GmailPart | null | undefined): string {
  if (!payload) return "";

  const mime = payload.mimeType ?? "";

  // Single-part payload: body data is at root level
  if (payload.body?.data) {
    const text = Buffer.from(payload.body.data, "base64url").toString("utf8");
    if (mime === "text/html") {
      return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
    return text;
  }

  // Multipart payload: search parts, preferring text/plain
  if (payload.parts) {
    const textPart = findPart(payload.parts, "text/plain");
    if (textPart?.body?.data) {
      return Buffer.from(textPart.body.data, "base64url").toString("utf8");
    }
    const htmlPart = findPart(payload.parts, "text/html");
    if (htmlPart?.body?.data) {
      return Buffer.from(htmlPart.body.data, "base64url").toString("utf8")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    // Recurse into nested multipart containers (multipart/alternative, etc.)
    for (const part of payload.parts) {
      if (part.mimeType?.startsWith("multipart/")) {
        const nested = extractBody(part);
        if (nested) return nested;
      }
    }
  }

  return "";
}

function findPart(parts: GmailPart[], mimeType: string): GmailPart | null {
  for (const part of parts) {
    if (part.mimeType === mimeType && part.body?.data) return part;
    if (part.parts) {
      const found = findPart(part.parts, mimeType);
      if (found) return found;
    }
  }
  return null;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors. If the `GmailPart` type conflicts with the existing Gmail SDK types, adjust the type to match what `msg.payload` actually is (a `Schema$MessagePart`), but the logic stays the same.

- [ ] **Step 3: Run the full test suite to confirm nothing regressed**

```bash
npx vitest run
```

Expected: All tests pass (including the existing gmail-sync tests).

- [ ] **Step 4: Commit**

```bash
git add lib/google.ts
git commit -m "fix: extractBody checks mimeType and recurses into nested multipart"
```

---

## Task 7: Update conversation detail page — use `EmailBody`, fix layout

**Files:**
- Modify: `app/conversations/[id]/page.tsx`

This task makes two independent changes: (a) swap `<p>{message.body}</p>` for `<EmailBody>` and (b) add `min-w-0` to the main section.

- [ ] **Step 1: Add the `EmailBody` import**

At the top of `app/conversations/[id]/page.tsx`, add:

```typescript
import EmailBody from "@/app/components/EmailBody";
```

(Add it after the existing local component imports, e.g. after line 17 `import AutoDraftTrigger from ...`.)

- [ ] **Step 2: Fix the main section's grid column**

Find this line (around line 244):

```tsx
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
```

Replace with:

```tsx
        <section className="min-w-0 overflow-x-hidden rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
```

- [ ] **Step 3: Replace the message body `<p>` with `<EmailBody>`**

Find this block (around lines 255–265):

```tsx
                    <div
                      className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                        isOutbound
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-900"
                      }`}
                    >
                      <p>{message.body}</p>
                      <p className="mt-1 text-xs opacity-70">
                        {message.createdAt.toLocaleString()}
                      </p>
                    </div>
```

Replace with:

```tsx
                    <div
                      className={`max-w-[75%] min-w-0 rounded-2xl px-4 py-2 text-sm ${
                        isOutbound
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-900"
                      }`}
                    >
                      <EmailBody body={message.body} />
                      <p className="mt-1 text-xs opacity-70">
                        {message.createdAt.toLocaleString()}
                      </p>
                    </div>
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Run the full test suite**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/conversations/[id]/page.tsx
git commit -m "fix: render email body with sanitized HTML and auto-linked URLs"
```

---

## Task 8: Smoke-test in the browser

**Files:** None modified — this is a verification step.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Navigate to a conversation with an HTML email body**

Open `http://localhost:3000/inbox`, click a conversation that contains an HTML email (e.g. an Azure or marketing notification). Verify:
- The email body shows readable prose, not `<!DOCTYPE html...>` markup
- No page-level horizontal scrollbar
- Right sidebar (Contact / Label / Assistant Context) remains fully visible

- [ ] **Step 3: Navigate to a conversation with a plain-text email containing a URL**

Open a conversation like the Google Docs share email. Verify:
- The Google Docs URL appears as a clickable blue underlined link
- Clicking it opens the URL in a new tab

- [ ] **Step 4: Stop the dev server and commit nothing** (this was a verification step only)

---

## Self-Review Checklist

- **Spec: HTML raw text fixed** → Task 3 (`renderEmailBodyHtml`) + Task 5 (`EmailBody`) + Task 7 (page wiring)
- **Spec: Links clickable** → Task 3 (`linkifyText`) with `target="_blank"` + `rel`
- **Spec: Overflow CSS** → Task 4 (`.email-body` CSS) + Task 7 (`min-w-0` on section)
- **Spec: Sidebar stays visible** → Task 7 (`min-w-0 overflow-x-hidden` on section)
- **Spec: XSS/sanitization** → Task 3 (`sanitizeEmailHtml` with `sanitize-html` allow-list)
- **Spec: Gmail source fix** → Task 6 (`extractBody` mimeType check + recursion)
- **Spec: Tests** → Task 2 (failing tests written first per TDD)
- **No placeholders or TBDs** — all code is complete and exact
- **Type consistency** — `renderEmailBodyHtml(body: string): string` in Task 3, `EmailBody({ body }: { body: string })` in Task 5, called as `<EmailBody body={message.body} />` in Task 7 — all consistent
