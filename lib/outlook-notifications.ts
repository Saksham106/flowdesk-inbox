import { createHash, timingSafeEqual } from "node:crypto"
import { decryptString } from "@/lib/crypto"
import { prisma } from "@/lib/prisma"

const MAX_NOTIFICATIONS_PER_REQUEST = 1000
const ALLOWED_CHANGE_TYPES = new Set(["created", "updated", "deleted"])

type GraphNotification = {
  id?: string
  subscriptionId?: string
  clientState?: string
  changeType?: string
  resource?: string
  subscriptionExpirationDateTime?: string
  resourceData?: { id?: string }
}

export class InvalidOutlookNotification extends Error {
  constructor(message: string, public readonly status: 400 | 401 = 400) {
    super(message)
  }
}

export async function queueOutlookNotifications(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new InvalidOutlookNotification("Malformed notification payload")
  }
  const value = (payload as { value?: unknown }).value
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_NOTIFICATIONS_PER_REQUEST) {
    throw new InvalidOutlookNotification("Malformed notification batch")
  }

  const events = []
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new InvalidOutlookNotification("Malformed notification")
    }
    const notification = raw as GraphNotification
    if (
      !notification.subscriptionId ||
      !notification.clientState ||
      !notification.changeType ||
      !ALLOWED_CHANGE_TYPES.has(notification.changeType) ||
      !notification.resource
    ) {
      throw new InvalidOutlookNotification("Malformed notification")
    }

    const credential = await prisma.outlookCredential.findUnique({
      where: { subscriptionId: notification.subscriptionId },
      include: { channel: { select: { tenantId: true } } },
    })
    if (!credential?.subscriptionClientStateEncrypted) {
      throw new InvalidOutlookNotification("Unknown notification subscription", 401)
    }

    const expected = Buffer.from(
      decryptString(credential.subscriptionClientStateEncrypted),
      "utf8"
    )
    const received = Buffer.from(notification.clientState, "utf8")
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new InvalidOutlookNotification("Invalid notification client state", 401)
    }

    events.push({
      tenantId: credential.channel.tenantId,
      channelId: credential.channelId,
      notificationId: notification.id ?? notificationFingerprint(notification),
      subscriptionId: notification.subscriptionId,
      resource: notification.resource,
      changeType: notification.changeType,
    })
  }

  const result = await prisma.outlookSyncEvent.createMany({
    data: events,
    skipDuplicates: true,
  })
  return { accepted: events.length, queued: result.count }
}

function notificationFingerprint(notification: GraphNotification) {
  return createHash("sha256")
    .update([
      notification.subscriptionId,
      notification.changeType,
      notification.resource,
      notification.resourceData?.id,
      notification.subscriptionExpirationDateTime,
    ].join("\0"))
    .digest("hex")
}
