import { processAgentJobWork } from "@/lib/agent/job-executor"
import { processPendingEmailWritebackJobs } from "@/lib/agent/email-writeback-processor"
import { runGmailPushRetryCron } from "@/lib/agent/gmail-push-retry"
import { runSnoozeCheckCron } from "@/lib/agent/snooze-check"
import { runDueWorkflows } from "@/lib/agent/workflow-runner"
import { processOutlookSyncWork } from "@/lib/outlook-worker"
import { runFollowUpLabelSweep, runFollowUpBatch } from "@/lib/agent/follow-up"
import { runLeadSequenceBatch } from "@/lib/agent/lead-sequence"
import { runEmailStateReconcileCron } from "@/lib/agent/email-state-reconcile"
import { runEmailLabelReconcileCron } from "@/lib/agent/email-label-reconcile"
import { runGmailWatchRenewalCron } from "@/lib/agent/gmail-watch-renewal"
import { runSnippetMineCron } from "@/lib/agent/snippet-miner"
import { runDataRetentionCron } from "@/lib/agent/data-retention"
import { runValueSnapshotCron } from "@/lib/agent/value-report"

// Registry of every background job that used to depend entirely on an
// external cron caller hitting its HTTP route with CRON_SECRET. This app is
// deployed on Railway with nothing configured to ever call those routes —
// see lib/scheduler/run-scheduler.ts for how this registry gets driven.
//
// Interval choices are deliberately conservative, not maximal-throughput:
// this scheduler shares the same Node process (and DB connection pool) as
// the web server, so job frequency trades off against request latency.
export type ScheduledJob = {
  name: string
  run: () => Promise<unknown>
  intervalMs: number
  // Run once shortly after boot in addition to the interval, for jobs where
  // a fresh deploy shouldn't wait a full interval before doing anything.
  runOnStart?: boolean
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE

export function buildJobRegistry(): ScheduledJob[] {
  return [
    {
      name: "agent-jobs",
      intervalMs: MINUTE,
      runOnStart: true,
      run: () => processAgentJobWork(),
    },
    {
      name: "email-writeback",
      intervalMs: MINUTE,
      runOnStart: true,
      run: () => processPendingEmailWritebackJobs(25),
    },
    {
      name: "gmail-push-retry",
      intervalMs: 5 * MINUTE,
      run: () => runGmailPushRetryCron(),
    },
    {
      name: "snooze-check",
      intervalMs: 5 * MINUTE,
      run: () => runSnoozeCheckCron(),
    },
    {
      name: "workflow-runner",
      intervalMs: 5 * MINUTE,
      run: () => runDueWorkflows(),
    },
    {
      name: "outlook-sync",
      intervalMs: 5 * MINUTE,
      run: () => processOutlookSyncWork(),
    },
    {
      name: "follow-up",
      intervalMs: 30 * MINUTE,
      run: async () => {
        const labelSweep = await runFollowUpLabelSweep()
        const result = await runFollowUpBatch()
        return { ...result, labelSweep }
      },
    },
    {
      name: "lead-sequence",
      intervalMs: 30 * MINUTE,
      run: () => runLeadSequenceBatch(),
    },
    {
      name: "email-state-reconcile",
      intervalMs: 30 * MINUTE,
      run: () => runEmailStateReconcileCron(),
    },
    {
      name: "email-label-reconcile",
      intervalMs: 6 * HOUR,
      run: () => runEmailLabelReconcileCron(),
    },
    {
      name: "gmail-watch",
      intervalMs: 6 * HOUR,
      run: () => runGmailWatchRenewalCron(),
    },
    {
      name: "snippet-mine",
      intervalMs: 24 * HOUR,
      run: () => runSnippetMineCron(),
    },
    {
      name: "data-retention",
      // Prunes AuditLog / AiUsageEvent / GmailPushEvent past their retention
      // windows. runOnStart so a fresh deploy reclaims space immediately
      // instead of waiting a day (the delete is a no-op when nothing is old).
      intervalMs: 24 * HOUR,
      runOnStart: true,
      run: () => runDataRetentionCron(),
    },
    {
      name: "value-snapshot",
      // buildValueSnapshot upserts on (tenantId, weekEnding), so running more
      // often than weekly is harmless — it just keeps refining the same row
      // until the week rolls over. Runs daily so a tenant's snapshot isn't
      // stale for up to a week if the process restarts near the boundary.
      intervalMs: 24 * HOUR,
      run: () => runValueSnapshotCron(),
    },
  ]
}
