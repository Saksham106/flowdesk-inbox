import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { canReconnectChannel } from "@/lib/channel-ownership"
import { encryptString } from "@/lib/crypto"
import {
  verifyOutlookState,
  exchangeOutlookCode,
  getOutlookUserEmail,
} from "@/lib/microsoft"
import { runOutlookDeltaSync } from "@/lib/outlook-sync"
import { ensureOutlookSubscription } from "@/lib/outlook-subscriptions"
import { ensureFlowDeskCategories } from "@/lib/outlook-mailbox"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")

  const redirectBase = `${process.env.NEXTAUTH_URL}/settings/connect`

  if (error) return NextResponse.redirect(`${redirectBase}?error=outlook_denied`)
  if (!code || !state) return NextResponse.redirect(`${redirectBase}?error=invalid_callback`)

  const tenantId = verifyOutlookState(state)
  if (!tenantId) return NextResponse.redirect(`${redirectBase}?error=invalid_state`)

  let tokens: Awaited<ReturnType<typeof exchangeOutlookCode>>
  try {
    tokens = await exchangeOutlookCode(code)
  } catch {
    return NextResponse.redirect(`${redirectBase}?error=token_exchange_failed`)
  }

  let outlookEmail: string
  try {
    outlookEmail = await getOutlookUserEmail(tokens.accessToken)
  } catch {
    return NextResponse.redirect(`${redirectBase}?error=userinfo_failed`)
  }

  if (!outlookEmail) return NextResponse.redirect(`${redirectBase}?error=no_email`)

  const existing = await prisma.channel.findUnique({ where: { emailAddress: outlookEmail } })
  const isNewConnection = !existing
  let channelId: string

  if (existing) {
    if (!canReconnectChannel(existing.tenantId, tenantId)) {
      return NextResponse.redirect(`${redirectBase}?error=account_already_connected`)
    }
    channelId = existing.id
    await prisma.outlookCredential.update({
      where: { channelId },
      data: {
        accessTokenEncrypted: encryptString(tokens.accessToken),
        refreshTokenEncrypted: encryptString(tokens.refreshToken),
        tokenExpiry: tokens.expiresAt,
      },
    })
  } else {
    const channel = await prisma.channel.create({
      data: {
        tenantId,
        type: "email",
        provider: "microsoft",
        emailAddress: outlookEmail,
        outlookCredential: {
          create: {
            accessTokenEncrypted: encryptString(tokens.accessToken),
            refreshTokenEncrypted: encryptString(tokens.refreshToken),
            tokenExpiry: tokens.expiresAt,
          },
        },
      },
    })
    channelId = channel.id
  }

  try {
    await runOutlookDeltaSync({ channelId, tenantId, requestedMode: "oauth_callback" })
  } catch {
    console.error("[outlook/callback] initial delta sync failed", { channelId })
  }
  try {
    await ensureOutlookSubscription(channelId)
  } catch {
    console.error("[outlook/callback] subscription setup failed", { channelId })
  }
  try {
    await ensureFlowDeskCategories(channelId)
  } catch (err) {
    console.error("[outlook/callback] category bootstrap failed:", err)
  }

  // A fresh connection goes to the onboarding proof screen, which runs the
  // first-pass over existing mail and shows what was organized. A reconnect
  // (credential refresh on an already-known account) skips it and returns to
  // Settings — that inbox is already organized. Mirrors the gmail callback's
  // new-vs-reconnect decision.
  if (isNewConnection) {
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/onboarding?connected=outlook`)
  }

  return NextResponse.redirect(`${redirectBase}?connected=${encodeURIComponent(outlookEmail)}`)
}
