# Inbox Navigation Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Organize the inbox navigation so filters and product areas are distinct, and personal accounts are not exposed to business-only tools.

**Architecture:** Add a pure navigation helper that maps account type to primary and secondary destinations. Update the inbox page to use that helper, then guard business-only pages server-side before data loading.

**Tech Stack:** Next.js App Router, React server components, Prisma, Vitest.

---

### Task 1: Navigation Helper

**Files:**
- Create: `lib/app-navigation.ts`
- Modify: `tests/client-navigation.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that assert personal accounts only get Digest, Tasks, and Settings as primary links, while business accounts get Digest and Tasks as primary links and Leads, Approvals, Reports, Audit, and Settings as secondary links.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/client-navigation.test.ts`
Expected: FAIL because `getInboxNavigation` does not exist.

- [ ] **Step 3: Implement helper**

Create `lib/app-navigation.ts` with `getInboxNavigation(accountType)` and exported item types.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/client-navigation.test.ts`
Expected: PASS.

### Task 2: Inbox Header Organization

**Files:**
- Modify: `app/inbox/page.tsx`

- [ ] **Step 1: Fetch tenant account type**

Load `prisma.tenant.findUnique({ where: { id: tenantId }, select: { accountType: true } })` with the existing inbox queries.

- [ ] **Step 2: Replace duplicated nav markup**

Render primary links from `getInboxNavigation`. Render secondary links in a compact `details` menu when any exist. Keep status tabs in their current separate row.

- [ ] **Step 3: Run TypeScript/test verification**

Run: `npm test -- tests/client-navigation.test.ts`
Expected: PASS.

### Task 3: Personal Account Guards

**Files:**
- Modify: `app/leads/page.tsx`
- Modify: `app/reports/page.tsx`
- Modify: `app/audit/page.tsx`

- [ ] **Step 1: Add account-type checks**

After authentication, read the tenant account type and redirect personal tenants to `/inbox` before business-only data is loaded.

- [ ] **Step 2: Verify**

Run: `npm test`
Expected: PASS.

### Task 4: Rendered QA And Publish

**Files:**
- No committed temporary files.

- [ ] **Step 1: Run frontend validation**

Start the Next.js dev server, open the inbox, verify that page content is not blank, status filters remain separate, and the More menu exposes secondary tools for a business account.

- [ ] **Step 2: Commit and open PR**

Stage intended files only, commit, push `codex/organize-inbox-navigation`, and create a draft PR.
