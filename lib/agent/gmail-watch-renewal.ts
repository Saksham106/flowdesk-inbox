import { prisma } from "@/lib/prisma"
import { renewGmailWatchIfNeeded } from "@/lib/google"

export type GmailWatchRenewalResult = {
  renewed: number
  errors: number
  skipped?: true
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown Gmail watch renewal error"
}

// Gmail push watches expire after 7 days; renews anything expiring within 48h
// (or never watched at all, historyId present) so Pub/Sub notifications keep
// flowing without a gap. Returns { skipped: true } when GMAIL_PUSH_TOPIC isn't
// configured — push isn't set up for this environment, nothing to renew.
export async function runGmailWatchRenewalCron(): Promise<GmailWatchRenewalResult> {
  const topicName = process.env.GMAIL_PUSH_TOPIC
  if (!topicName) {
    return { renewed: 0, errors: 0, skipped: true }
  }

  const channels = await prisma.gmailCredential.findMany({
    where: {
      historyId: { not: null },
      OR: [
        { watchExpiresAt: null },
        { watchExpiresAt: { lt: new Date(Date.now() + 48 * 60 * 60 * 1000) } },
      ],
    },
    include: { channel: true },
  })

  let renewed = 0
  let errors = 0

  for (const cred of channels) {
    const attemptedAt = new Date()
    try {
      const renewedChannel = await renewGmailWatchIfNeeded(cred.channelId, topicName)
      if (renewedChannel) renewed++
      await prisma.gmailCredential.update({
        where: { channelId: cred.channelId },
        data: {
          watchLastRenewalAttempt: attemptedAt,
          watchRenewalError: null,
        },
      })
      await prisma.auditLog.create({
        data: {
          tenantId: cred.channel.tenantId,
          action: "gmail_watch.renewal_attempt",
          payloadJson: {
            channelId: cred.channelId,
            success: true,
            renewed: renewedChannel,
          },
        },
      })
    } catch (err) {
      const message = getErrorMessage(err)
      console.error(`Failed to renew watch for channel ${cred.channelId}:`, err)
      errors++
      await prisma.gmailCredential
        .update({
          where: { channelId: cred.channelId },
          data: {
            watchLastRenewalAttempt: attemptedAt,
            watchRenewalError: message,
          },
        })
        .catch(() => {})
      await prisma.auditLog
        .create({
          data: {
            tenantId: cred.channel.tenantId,
            action: "gmail_watch.renewal_failed",
            payloadJson: {
              channelId: cred.channelId,
              success: false,
              error: message,
            },
          },
        })
        .catch(() => {})
    }
  }

  return { renewed, errors }
}
