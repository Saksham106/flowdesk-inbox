import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"

// A writeback job that exhausts its retries stays `failed` forever — even when
// the failure was the credential (expired/revoked token → invalid_grant), not
// the job itself. Those zombie rows keep the operator health panel critical
// ("N failed writeback jobs") long after the user reconnects. A successful
// OAuth reconnect is exactly the moment they become retryable again, so flip
// them back to pending with a fresh attempt budget and let the normal
// writeback cron drain them. Idempotent, and best-effort: a reconnect must
// never fail because of this bookkeeping.
export async function requeueFailedWritebacksForChannel(
  channelId: string,
  tenantId: string,
  auditPrefix: "gmail" | "outlook"
): Promise<number> {
  try {
    const requeued = await prisma.emailWritebackQueue.updateMany({
      where: { channelId, tenantId, status: "failed" },
      data: { status: "pending", attempts: 0, lastError: null, nextAttemptAt: new Date() },
    })
    if (requeued.count > 0) {
      await prisma.auditLog.create({
        data: {
          tenantId,
          action: `${auditPrefix}.writeback.requeued`,
          payloadJson: {
            channelId,
            count: requeued.count,
            source: "oauth_reconnect",
          } as Prisma.InputJsonValue,
        },
      })
    }
    return requeued.count
  } catch (err) {
    console.error("[email-writeback] requeue after reconnect failed:", err)
    return 0
  }
}
