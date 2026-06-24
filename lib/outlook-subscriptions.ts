import { randomBytes } from "crypto"
import { encryptString } from "@/lib/crypto"
import {
  getOutlookAccessToken,
  graphRequest,
  MICROSOFT_GRAPH_ROOT,
  MicrosoftGraphError,
} from "@/lib/microsoft"
import { prisma } from "@/lib/prisma"

const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000
const SUBSCRIPTION_LIFETIME_MS = 6 * 24 * 60 * 60 * 1000

type SubscriptionResponse = {
  id: string
  expirationDateTime: string
}

export async function ensureOutlookSubscription(channelId: string) {
  const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "")
  if (!baseUrl?.startsWith("https://")) {
    return { ok: true as const, skipped: "https_required" as const }
  }

  const credential = await prisma.outlookCredential.findUnique({
    where: { channelId },
  })
  if (!credential) throw new Error("No Outlook credential found for channel")

  if (
    credential.subscriptionId &&
    credential.subscriptionExpiresAt &&
    credential.subscriptionExpiresAt.getTime() > Date.now() + RENEW_BEFORE_MS
  ) {
    return {
      ok: true as const,
      subscriptionId: credential.subscriptionId,
      renewed: false,
    }
  }

  const attemptedAt = new Date()
  const expirationDateTime = new Date(
    attemptedAt.getTime() + SUBSCRIPTION_LIFETIME_MS
  ).toISOString()
  const token = await getOutlookAccessToken(channelId)

  await prisma.outlookCredential.update({
    where: { channelId },
    data: { subscriptionLastRenewalAttempt: attemptedAt },
  })

  if (credential.subscriptionId) {
    try {
      const renewed = await graphRequest<SubscriptionResponse>(
        `${MICROSOFT_GRAPH_ROOT}/subscriptions/${credential.subscriptionId}`,
        token,
        { method: "PATCH", body: { expirationDateTime } }
      )
      await prisma.outlookCredential.update({
        where: { channelId },
        data: {
          subscriptionExpiresAt: new Date(renewed.expirationDateTime),
          subscriptionError: null,
        },
      })
      return {
        ok: true as const,
        subscriptionId: renewed.id,
        renewed: true,
      }
    } catch (error) {
      if (!(error instanceof MicrosoftGraphError) || error.status !== 404) {
        await prisma.outlookCredential.update({
          where: { channelId },
          data: { subscriptionError: "renewal_failed" },
        })
        throw error
      }
    }
  }

  const clientState = randomBytes(32).toString("base64url")
  try {
    const created = await graphRequest<SubscriptionResponse>(
      `${MICROSOFT_GRAPH_ROOT}/subscriptions`,
      token,
      {
        method: "POST",
        body: {
          changeType: "created,updated,deleted",
          notificationUrl: `${baseUrl}/api/connectors/outlook/webhook`,
          resource: "me/mailFolders('Inbox')/messages",
          expirationDateTime,
          clientState,
          latestSupportedTlsVersion: "v1_2",
        },
      }
    )
    await prisma.outlookCredential.update({
      where: { channelId },
      data: {
        subscriptionId: created.id,
        subscriptionExpiresAt: new Date(created.expirationDateTime),
        subscriptionClientStateEncrypted: encryptString(clientState),
        subscriptionError: null,
      },
    })
    return {
      ok: true as const,
      subscriptionId: created.id,
      renewed: true,
    }
  } catch (error) {
    await prisma.outlookCredential.update({
      where: { channelId },
      data: { subscriptionError: "creation_failed" },
    })
    throw error
  }
}

export async function deleteOutlookSubscription(channelId: string) {
  const credential = await prisma.outlookCredential.findUnique({
    where: { channelId },
  })
  if (!credential?.subscriptionId) return

  const token = await getOutlookAccessToken(channelId)
  await graphRequest<void>(
    `${MICROSOFT_GRAPH_ROOT}/subscriptions/${credential.subscriptionId}`,
    token,
    { method: "DELETE" }
  )
  await prisma.outlookCredential.update({
    where: { channelId },
    data: {
      subscriptionId: null,
      subscriptionExpiresAt: null,
      subscriptionClientStateEncrypted: null,
      subscriptionError: null,
    },
  })
}
