import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { encryptString } from "@/lib/crypto"
import {
  verifyOutlookState,
  exchangeOutlookCode,
  getOutlookUserEmail,
} from "@/lib/microsoft"
import { runOutlookDeltaSync } from "@/lib/outlook-sync"
import { ensureOutlookSubscription } from "@/lib/outlook-subscriptions"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")

  const redirectBase = `${process.env.NEXTAUTH_URL}/settings/connect`

  if (error) return NextResponse.redirect(`${redirectBase}?error=google_denied`)
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
  let channelId: string

  if (existing) {
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

  return NextResponse.redirect(`${redirectBase}?connected=${encodeURIComponent(outlookEmail)}`)
}
