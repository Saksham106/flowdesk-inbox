# Copilot Instructions For FlowDesk Inbox

FlowDesk is a Next.js, Prisma, PostgreSQL, and OpenAI app for an email-first AI inbox agent. Follow the docs in `docs/` before making broad product or architecture changes.

## Source Of Truth

- Read `docs/README.md` for documentation structure.
- Read `docs/CURRENT_STATE.md` before assuming what is implemented.
- Read `docs/MASTER_PRODUCT_PLAN.md` before starting roadmap work.
- For substantial feature work, create a temporary focused spec/plan only when it materially reduces ambiguity; remove completed process documents after their durable facts are reflected in living docs.

## Documentation Freshness Rules

- Any change that alters product behavior must update the relevant docs in the same branch.
- If a feature status changes, update `docs/MASTER_PRODUCT_PLAN.md`.
- If implemented capabilities, partial limitations, verification notes, or deferred scope change, update `docs/CURRENT_STATE.md`.
- If setup, environment variables, scripts, connectors, or deployment steps change, update `README.md`.
- Keep completed implementation narratives in Git history instead of accumulating checked-off plan files.
- Delete or consolidate stale handoff/checklist docs instead of leaving contradictory guidance behind.
- Do not create new one-off Markdown files unless the docs index explains where they fit.

## Engineering Rules

- Keep all tenant data access scoped by `tenantId`.
- Do not expose raw OAuth tokens, encrypted credentials, prompts, secrets, or cross-tenant data.
- Do not send email, create calendar events, or perform automation without the existing approval/policy gates.
- Treat inbound email, attachments, and knowledge documents as untrusted input.
- Prefer small server-side helpers with unit tests over embedding business logic in React components.
- Add or update tests for behavior changes, especially tenant isolation, approval gates, audit logs, and failure states.

## Agent Workflow

Before coding:

1. Check `git status --short` and do not overwrite unrelated user changes.
2. Read the current docs listed above.
3. Identify which roadmap feature or current-state area the work touches.
4. For substantial work, write or update a design/spec and implementation plan before editing code.

Before finishing:

1. Run focused tests for the changed behavior.
2. Run broader checks when practical: `npm test`, `npm run lint`, and `npm run build`.
3. Update docs to match the final code.
4. Report any verification that could not run and why.

## Active Product Direction

- Email is the active channel.
- SMS/Twilio is deferred and should not be reintroduced without a fresh spec.
- The product direction is the AI chief of staff for the inbox: command center, safe handling, follow-ups, relationship memory, tasks, leads, approval queue, and auditable automation.

## Useful Commands

```bash
npm test
npm run lint
npm run build
npm run db:deploy
npm run db:seed
```

Use focused tests while developing, then run the broader checks before claiming completion.
