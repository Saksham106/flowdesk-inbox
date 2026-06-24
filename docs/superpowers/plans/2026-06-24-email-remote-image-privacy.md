# Email Remote-Image Privacy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Block network-backed email images by default and provide a per-message opt-in that preserves safe newsletter rendering.

**Architecture:** The server component produces independently sanitized blocked and opt-in HTML variants, so raw email HTML never reaches the browser. The iframe document enforces a matching default-deny CSP, while the client component owns only the ephemeral per-message opt-in state.

**Tech Stack:** Next.js 14, React 18, TypeScript, sanitize-html, Vitest

---

### Task 1: Make remote-image sanitization explicit

**Files:**
- Modify: `lib/email-body.ts`
- Test: `tests/email-body.test.ts`

- [x] **Step 1: Write failing sanitizer tests**

Add tests proving the default sanitizer removes HTTP and HTTPS image sources while preserving `alt`, dimensions, and `cid:` sources; add a test proving `{ allowRemoteImages: true }` preserves HTTPS but still removes HTTP; add detection tests for `hasRemoteEmailImages`.

- [x] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/email-body.test.ts`

Expected: FAIL because remote images are currently preserved and the options/detection API does not exist.

- [x] **Step 3: Implement the minimal sanitizer API**

Add:

```ts
export type EmailIframeSanitizeOptions = { allowRemoteImages?: boolean };

export function hasRemoteEmailImages(html: string): boolean {
  const imageOnly = sanitizeHtml(html, {
    allowedTags: ["img"],
    allowedAttributes: { img: ["src"] },
    allowedSchemesByTag: { img: ["http", "https"] },
  });
  return /<img\b[^>]*\bsrc=["']https?:\/\//i.test(imageOnly);
}
```

Change `sanitizeEmailHtmlForIframe` to accept the options object and add an `img` transform. The transform removes every remote source unless opt-in is true and the source uses HTTPS. It leaves non-network `cid:` sources and layout attributes for the sanitizer to validate.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- tests/email-body.test.ts`

Expected: all email-body tests pass.

### Task 2: Enforce containment in the iframe document

**Files:**
- Modify: `lib/email-iframe.ts`
- Test: `tests/email-iframe.test.ts`

- [x] **Step 1: Write failing CSP tests**

Add tests that call `buildEmailIframeSrcDoc` in default and opt-in modes. Assert the default document contains `default-src 'none'` and `img-src data: cid:` without `https:`, while opt-in contains `img-src https: data: cid:`. Both policies must contain `connect-src 'none'`, `font-src 'none'`, `frame-src 'none'`, `form-action 'none'`, and `base-uri 'none'`.

- [x] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/email-iframe.test.ts`

Expected: FAIL because no CSP is currently injected and no options argument exists.

- [x] **Step 3: Implement policy generation**

Add:

```ts
export type EmailIframeOptions = { allowRemoteImages?: boolean };

function emailContentSecurityPolicy(allowRemoteImages: boolean): string {
  const images = allowRemoteImages ? "https: data: cid:" : "data: cid:";
  return [
    "default-src 'none'",
    `img-src ${images}`,
    "style-src 'unsafe-inline'",
    "font-src 'none'",
    "connect-src 'none'",
    "media-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}
```

Inject the escaped policy as the first metadata entry in `buildEmailIframeSrcDoc`. Default `allowRemoteImages` to false.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- tests/email-iframe.test.ts`

Expected: all email-iframe tests pass.

### Task 3: Add per-message image loading UX

**Files:**
- Modify: `app/components/EmailBody.tsx`
- Modify: `app/components/EmailBodyIframe.tsx`
- Create: `tests/email-privacy-ui.test.ts`

- [x] **Step 1: Write a failing wiring test**

Create a source-level regression test following existing UI wiring tests. Assert `EmailBody` uses `hasRemoteEmailImages`, creates blocked and opt-in sanitized variants, and passes `remoteHtml`; assert `EmailBodyIframe` contains the privacy notice, `Load images` button, `referrerPolicy="no-referrer"`, and calls `buildEmailIframeSrcDoc` with the opt-in state.

- [x] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/email-privacy-ui.test.ts`

Expected: FAIL because the UI and props are absent.

- [x] **Step 3: Implement server/client wiring**

In `EmailBody`, compute:

```ts
const hasRemoteImages = hasRemoteEmailImages(body);
const blockedHtml = sanitizeEmailHtmlForIframe(body);
const remoteHtml = hasRemoteImages
  ? sanitizeEmailHtmlForIframe(body, { allowRemoteImages: true })
  : undefined;
```

Pass `blockedHtml` as `html` and the optional `remoteHtml` to `EmailBodyIframe`.

In `EmailBodyIframe`, track `remoteImagesLoaded`, reset it when the two HTML props change, render the compact privacy notice only when `remoteHtml` exists and is not selected, and render the selected variant with the matching CSP option. Add `referrerPolicy="no-referrer"` to the iframe.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- tests/email-privacy-ui.test.ts tests/email-body.test.ts tests/email-iframe.test.ts`

Expected: all privacy tests pass.

### Task 4: Document and verify issue #45

**Files:**
- Modify: `docs/CURRENT_STATE.md`

- [x] **Step 1: Document privacy behavior**

Update the current-state email rendering entry to state that remote images and other network loads are blocked by default, users can opt into HTTPS images for the displayed message, and the choice is not persisted.

- [x] **Step 2: Run complete verification**

Run:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
git diff --check
```

Expected: all commands exit 0; 606 or more tests pass.

- [x] **Step 3: Commit the implementation**

Stage only issue #45 implementation, tests, and docs. Commit with:

```bash
git commit -m "fix: block remote email images by default (#45)"
```

- [ ] **Step 4: Publish and report**

Push `codex/issue-45-email-privacy`, open a draft PR targeting `main`, and comment on issue #45 with the root cause, behavior change, test/build evidence, and PR link. Leave the issue open until the PR is merged and the acceptance criteria are verified on `main`.
