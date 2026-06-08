import { NextResponse } from "next/server";
import { google } from "googleapis";
import type { Credentials } from "google-auth-library";

import { prisma } from "@/lib/prisma";
import { encryptString } from "@/lib/crypto";
import { createCalendarOAuth2Client, verifyCalendarState } from "@/lib/google";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const redirectBase = `${process.env.NEXTAUTH_URL}/settings`;

  if (error) {
    return NextResponse.redirect(`${redirectBase}?cal_error=google_denied`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${redirectBase}?cal_error=invalid_callback`);
  }

  const tenantId = verifyCalendarState(state);
  if (!tenantId) {
    return NextResponse.redirect(`${redirectBase}?cal_error=invalid_state`);
  }

  const auth = createCalendarOAuth2Client();
  let tokens: Credentials;
  try {
    const res = await auth.getToken(code);
    tokens = res.tokens;
  } catch {
    return NextResponse.redirect(`${redirectBase}?cal_error=token_exchange_failed`);
  }

  if (!tokens.access_token || !tokens.refresh_token) {
    return NextResponse.redirect(`${redirectBase}?cal_error=missing_tokens`);
  }

  // Get the Google account email
  auth.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth });
  let accountEmail: string;
  try {
    const info = await oauth2.userinfo.get();
    accountEmail = info.data.email ?? "";
  } catch {
    return NextResponse.redirect(`${redirectBase}?cal_error=userinfo_failed`);
  }

  if (!accountEmail) {
    return NextResponse.redirect(`${redirectBase}?cal_error=no_email`);
  }

  // Upsert credential
  await prisma.googleCalendarCredential.upsert({
    where: { tenantId_email: { tenantId, email: accountEmail } },
    create: {
      tenantId,
      email: accountEmail,
      accessTokenEncrypted: encryptString(tokens.access_token),
      refreshTokenEncrypted: encryptString(tokens.refresh_token),
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    },
    update: {
      accessTokenEncrypted: encryptString(tokens.access_token),
      refreshTokenEncrypted: encryptString(tokens.refresh_token),
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    },
  });

  return NextResponse.redirect(
    `${redirectBase}?cal_connected=${encodeURIComponent(accountEmail)}`
  );
}
