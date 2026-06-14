# Weekly Value Report — Implementation Plan

Date: 2026-06-11
Design: `docs/superpowers/specs/2026-06-11-weekly-value-report-design.md`

## Steps

1. `lib/agent/value-report.ts` — period helper, pure minutes-saved estimator with exported weight constants, `buildWeeklyValueReport` running 8 parallel tenant-scoped `count` queries.
2. `app/reports/page.tsx` — auth-gated server page: headline, 8 metric cards, time-saved card with transparent weights.
3. `app/inbox/page.tsx` — Reports link in desktop nav and mobile nav strip.
4. `tests/value-report.test.ts` — period math, estimator weighting and non-double-counting, report assembly, tenant scoping of draft (via conversation) and direct models.
5. Docs: `CURRENT_STATE.md`, master plan feature index (#32) and decision log, check off `docs/TODO.md`.

## Verification

```bash
npx vitest run tests/value-report.test.ts
npm test
npm run lint
npm run build
```
