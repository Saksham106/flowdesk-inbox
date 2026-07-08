// Next.js instrumentation hook — register() runs exactly once when the
// server process starts (next start / next dev), not per-request and not
// during next build. This is where the in-process background job scheduler
// boots (lib/scheduler/run-scheduler.ts): FlowDesk is deployed on Railway as
// a single long-running Node process with nothing external configured to
// call the /api/cron/* routes, so without this the classification pipeline,
// Gmail writeback retries, label reconciliation, follow-ups, and every other
// background job are silently dead in production.
//
// Guarded to the nodejs runtime only — register() also fires once for the
// edge runtime layer in some configurations, and the scheduler imports
// Prisma/Node-only modules.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/lib/scheduler/run-scheduler")
    startScheduler()
  }
}
