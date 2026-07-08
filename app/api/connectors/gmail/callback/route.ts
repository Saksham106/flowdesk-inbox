import { NextResponse } from "next/server";
import { google } from "googleapis";
import type { Credentials } from "google-auth-library";

import { prisma } from "@/lib/prisma";
import { encryptString } from "@/lib/crypto";
import { createOAuth2Client, ensureFlowDeskLabels, verifyState } from "@/lib/google";
import { runGmailSync } from "@/lib/gmail-sync";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const redirectBase = `${process.env.NEXTAUTH_URL}/settings`;

  if (error) {
    return NextResponse.redirect(`${redirectBase}?error=google_denied`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${redirectBase}?error=invalid_callback`);
  }

  const tenantId = verifyState(state);
  if (!tenantId) {
    return NextResponse.redirect(`${redirectBase}?error=invalid_state`);
  }

  // Exchange authorization code for tokens
  const auth = createOAuth2Client();
  let tokens: Credentials;
  try {
    const res = await auth.getToken(code);
    tokens = res.tokens;
  } catch {
    return NextResponse.redirect(`${redirectBase}?error=token_exchange_failed`);
  }

  if (!tokens.access_token || !tokens.refresh_token) {
    return NextResponse.redirect(`${redirectBase}?error=missing_tokens`);
  }

  // Get the Gmail address for this account
  auth.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth });
  let gmailAddress: string;
  try {
    const info = await oauth2.userinfo.get();
    gmailAddress = info.data.email ?? "";
  } catch {
    return NextResponse.redirect(`${redirectBase}?error=userinfo_failed`);
  }

  if (!gmailAddress) {
    return NextResponse.redirect(`${redirectBase}?error=no_email`);
  }

  // Upsert Channel + GmailCredential
  const existing = await prisma.channel.findUnique({ where: { emailAddress: gmailAddress } });
  const isNewConnection = !existing;

  let channelId: string;

  if (existing) {
    // Already connected — refresh credentials, and reassign tenant if needed
    channelId = existing.id;
    await prisma.channel.update({
      where: { id: channelId },
      data: { tenantId },
    });
    await prisma.gmailCredential.update({
      where: { channelId },
      data: {
        accessTokenEncrypted: encryptString(tokens.access_token),
        refreshTokenEncrypted: encryptString(tokens.refresh_token),
        tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      },
    });
  } else {
    const channel = await prisma.channel.create({
      data: {
        tenantId,
        type: "email",
        provider: "google",
        emailAddress: gmailAddress,
        gmailCredential: {
          create: {
            accessTokenEncrypted: encryptString(tokens.access_token),
            refreshTokenEncrypted: encryptString(tokens.refresh_token),
            tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          },
        },
      },
    });
    channelId = channel.id;
  }

  // Bootstrap the flat FlowDesk label set so the mailbox is ready to be
  // organized. Idempotent (creates only missing labels, colors existing ones,
  // and cleans up legacy nested duplicates) and best-effort — a failure here
  // must not block the connection.
  try {
    await ensureFlowDeskLabels(channelId);
    await prisma.auditLog.create({
      data: {
        tenantId,
        action: "gmail.labels.bootstrapped",
        payloadJson: { channelId, source: "oauth_callback" },
      },
    });
  } catch (err) {
    console.error("[gmail/callback] label bootstrap failed:", err);
  }

  // Initial sync — import recent threads into inbox
  try {
    await runGmailSync({
      channelId,
      tenantId,
      requestedMode: "oauth_callback",
      incremental: false,
      ensureWatch: true,
    });
  } catch (err) {
    console.error("[gmail/callback] initial sync failed:", err);
  }

  // A fresh connection goes to the onboarding proof screen, which runs the
  // first-pass over existing mail and shows what was organized. A reconnect
  // (credential refresh on an already-known account) skips it and returns to
  // Settings — that inbox is already organized.
  if (isNewConnection) {
    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL}/onboarding?connected=${encodeURIComponent(gmailAddress)}`
    );
  }

  return NextResponse.redirect(`${redirectBase}?connected=${encodeURIComponent(gmailAddress)}`);
}
