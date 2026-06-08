import { google } from "googleapis";
import { createHmac } from "crypto";
import { encryptString, decryptString } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

function callbackUrl() {
  return `${process.env.NEXTAUTH_URL}/api/connectors/gmail/callback`;
}

function calendarCallbackUrl() {
  return `${process.env.NEXTAUTH_URL}/api/connectors/google-calendar/callback`;
}

export function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl()
  );
}

export function buildAuthUrl(state: string): string {
  const auth = createOAuth2Client();
  return auth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
    state,
  });
}

// Signs a CSRF state token: base64url("tenantId:timestamp:hmac")
export function signState(tenantId: string): string {
  const ts = Date.now().toString();
  const hmac = createHmac("sha256", process.env.NEXTAUTH_SECRET!)
    .update(`${tenantId}:${ts}`)
    .digest("hex");
  return Buffer.from(`${tenantId}:${ts}:${hmac}`).toString("base64url");
}

// Returns tenantId if valid, null if tampered or expired (10-min window)
export function verifyState(state: string): string | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const parts = decoded.split(":");
    if (parts.length < 3) return null;
    const hmac = parts[parts.length - 1];
    const ts = parts[parts.length - 2];
    const tenantId = parts.slice(0, parts.length - 2).join(":");
    const expected = createHmac("sha256", process.env.NEXTAUTH_SECRET!)
      .update(`${tenantId}:${ts}`)
      .digest("hex");
    if (hmac !== expected) return null;
    if (Date.now() - parseInt(ts) > 10 * 60 * 1000) return null;
    return tenantId;
  } catch {
    return null;
  }
}

// Returns an authenticated Gmail client, auto-refreshing tokens as needed
export async function getGmailClient(channelId: string) {
  const cred = await prisma.gmailCredential.findUnique({ where: { channelId } });
  if (!cred) throw new Error("No Gmail credential found for channel");

  const auth = createOAuth2Client();
  auth.setCredentials({
    access_token: decryptString(cred.accessTokenEncrypted),
    refresh_token: decryptString(cred.refreshTokenEncrypted),
    expiry_date: cred.tokenExpiry?.getTime(),
  });

  auth.on("tokens", async (tokens) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = {};
    if (tokens.access_token) updates.accessTokenEncrypted = encryptString(tokens.access_token);
    if (tokens.expiry_date) updates.tokenExpiry = new Date(tokens.expiry_date);
    if (tokens.refresh_token) updates.refreshTokenEncrypted = encryptString(tokens.refresh_token);
    if (Object.keys(updates).length > 0) {
      await prisma.gmailCredential.update({ where: { channelId }, data: updates });
    }
  });

  return google.gmail({ version: "v1", auth });
}

type GmailMessage = {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  date: Date;
  rfc822MessageId: string;
};

function getHeader(
  headers: Array<{ name?: string | null; value?: string | null }>,
  name: string
): string {
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

// Extracts the best plain-text body from a Gmail message payload
function extractBody(payload: {
  body?: { data?: string | null } | null;
  parts?: Array<{ mimeType?: string | null; body?: { data?: string | null } | null }> | null;
} | null | undefined): string {
  if (!payload) return "";
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
  }
  const textPart = payload.parts?.find((p) => p.mimeType === "text/plain");
  if (textPart?.body?.data) {
    return Buffer.from(textPart.body.data, "base64url").toString("utf8");
  }
  const htmlPart = payload.parts?.find((p) => p.mimeType === "text/html");
  if (htmlPart?.body?.data) {
    return Buffer.from(htmlPart.body.data, "base64url").toString("utf8")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

export async function fetchThread(
  gmail: ReturnType<typeof google.gmail>,
  threadId: string
): Promise<GmailMessage[]> {
  const res = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full",
  });

  return (res.data.messages ?? []).map((msg) => {
    const headers = msg.payload?.headers ?? [];
    return {
      id: msg.id ?? "",
      threadId: msg.threadId ?? "",
      from: getHeader(headers, "From"),
      to: getHeader(headers, "To"),
      subject: getHeader(headers, "Subject"),
      body: extractBody(msg.payload),
      date: new Date(parseInt(msg.internalDate ?? "0")),
      rfc822MessageId: getHeader(headers, "Message-ID"),
    };
  });
}

// Strips "Display Name <email@example.com>" → "email@example.com"
export function extractEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim().toLowerCase();
}

// Pulls recent INBOX threads and upserts them as Conversations + Messages
export async function syncGmailChannel(channelId: string, tenantId: string): Promise<number> {
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel?.emailAddress) throw new Error("Not an email channel");

  const gmail = await getGmailClient(channelId);

  const threadsRes = await gmail.users.threads.list({
    userId: "me",
    labelIds: ["INBOX"],
    maxResults: 25,
  });

  const threads = threadsRes.data.threads ?? [];
  let synced = 0;

  for (const thread of threads) {
    if (!thread.id) continue;

    const messages = await fetchThread(gmail, thread.id);
    if (messages.length === 0) continue;

    const firstMsg = messages[0];
    const lastMsg = messages[messages.length - 1];

    // Determine the external email (the one that isn't ours)
    const isFirstOutbound = extractEmail(firstMsg.from) === channel.emailAddress.toLowerCase();
    const externalRaw = isFirstOutbound ? firstMsg.to : firstMsg.from;
    const externalEmail = extractEmail(externalRaw);
    const externalDisplayName = externalRaw.replace(/<[^>]+>/, "").trim() || externalEmail;

    // Auto-create or find the contact (uses email in phoneE164 field)
    let contact = await prisma.contact.findUnique({
      where: { tenantId_phoneE164: { tenantId, phoneE164: externalEmail } },
    });
    if (!contact) {
      contact = await prisma.contact.create({
        data: { tenantId, name: externalDisplayName || externalEmail, phoneE164: externalEmail },
      });
    }

    // Upsert conversation
    const conversation = await prisma.conversation.upsert({
      where: { tenantId_channelId_externalThreadId: { tenantId, channelId, externalThreadId: thread.id } },
      create: {
        tenantId,
        channelId,
        externalThreadId: thread.id,
        contactId: contact.id,
        status: "needs_reply",
        lastMessageAt: lastMsg.date,
      },
      update: {
        lastMessageAt: lastMsg.date,
        contactId: contact.id,
      },
    });

    // Upsert each message
    for (const msg of messages) {
      const isOutbound = extractEmail(msg.from) === channel.emailAddress.toLowerCase();
      await prisma.message.upsert({
        where: { providerMessageId: `gmail_${msg.id}` },
        create: {
          conversationId: conversation.id,
          direction: isOutbound ? "outbound" : "inbound",
          fromE164: msg.from,
          toE164: msg.to,
          body: msg.body || `[${msg.subject}]`,
          providerMessageId: `gmail_${msg.id}`,
          createdAt: msg.date,
        },
        update: {},
      });
    }

    synced++;
  }

  return synced;
}

// Sends a reply in a Gmail thread, returns the new Gmail message ID
export async function sendGmailReply(
  gmail: ReturnType<typeof google.gmail>,
  {
    to,
    from,
    subject,
    body,
    threadId,
    inReplyTo,
    references,
  }: {
    to: string;
    from: string;
    subject: string;
    body: string;
    threadId: string;
    inReplyTo?: string;
    references?: string;
  }
): Promise<string> {
  const reSubject = subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${reSubject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
  ];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push("", body);

  const raw = Buffer.from(lines.join("\r\n")).toString("base64url");

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw, threadId },
  });

  return res.data.id ?? "";
}

// ── Google Calendar ────────────────────────────────────────────────────────────

export function createCalendarOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    calendarCallbackUrl()
  );
}

export function buildCalendarAuthUrl(state: string): string {
  const auth = createCalendarOAuth2Client();
  return auth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: CALENDAR_SCOPES,
    state,
  });
}

// State tokens for Calendar use a "cal:" prefix to namespace from Gmail state
export function signCalendarState(tenantId: string): string {
  const ts = Date.now().toString();
  const hmac = createHmac("sha256", process.env.NEXTAUTH_SECRET!)
    .update(`cal:${tenantId}:${ts}`)
    .digest("hex");
  return Buffer.from(`cal:${tenantId}:${ts}:${hmac}`).toString("base64url");
}

export function verifyCalendarState(state: string): string | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const parts = decoded.split(":");
    if (parts.length < 4 || parts[0] !== "cal") return null;
    const hmac = parts[parts.length - 1];
    const ts = parts[parts.length - 2];
    const tenantId = parts.slice(1, parts.length - 2).join(":");
    const expected = createHmac("sha256", process.env.NEXTAUTH_SECRET!)
      .update(`cal:${tenantId}:${ts}`)
      .digest("hex");
    if (hmac !== expected) return null;
    if (Date.now() - parseInt(ts) > 10 * 60 * 1000) return null;
    return tenantId;
  } catch {
    return null;
  }
}

export async function getCalendarClient(tenantId: string, email: string) {
  const cred = await prisma.googleCalendarCredential.findUnique({
    where: { tenantId_email: { tenantId, email } },
  });
  if (!cred) throw new Error("No Google Calendar credential found");

  const auth = createCalendarOAuth2Client();
  auth.setCredentials({
    access_token: decryptString(cred.accessTokenEncrypted),
    refresh_token: decryptString(cred.refreshTokenEncrypted),
    expiry_date: cred.tokenExpiry?.getTime(),
  });

  auth.on("tokens", async (tokens) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = {};
    if (tokens.access_token) updates.accessTokenEncrypted = encryptString(tokens.access_token);
    if (tokens.expiry_date) updates.tokenExpiry = new Date(tokens.expiry_date);
    if (tokens.refresh_token) updates.refreshTokenEncrypted = encryptString(tokens.refresh_token);
    if (Object.keys(updates).length > 0) {
      await prisma.googleCalendarCredential.update({
        where: { tenantId_email: { tenantId, email } },
        data: updates,
      });
    }
  });

  return google.calendar({ version: "v3", auth });
}

export type CalendarEvent = {
  id: string;
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  attendees: string[];
  location?: string;
  htmlLink?: string;
};

// List upcoming events from the primary calendar
export async function listEvents(
  calendar: ReturnType<typeof google.calendar>,
  { maxResults = 20, timeMin = new Date() }: { maxResults?: number; timeMin?: Date } = {}
): Promise<CalendarEvent[]> {
  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: timeMin.toISOString(),
    maxResults,
    singleEvents: true,
    orderBy: "startTime",
  });

  return (res.data.items ?? []).map((e) => ({
    id: e.id ?? "",
    summary: e.summary ?? "(No title)",
    description: e.description ?? undefined,
    start: new Date(e.start?.dateTime ?? e.start?.date ?? Date.now()),
    end: new Date(e.end?.dateTime ?? e.end?.date ?? Date.now()),
    attendees: (e.attendees ?? []).map((a) => a.email ?? "").filter(Boolean),
    location: e.location ?? undefined,
    htmlLink: e.htmlLink ?? undefined,
  }));
}

// Create a new event on the primary calendar
export async function createCalendarEvent(
  calendar: ReturnType<typeof google.calendar>,
  {
    summary,
    description,
    start,
    end,
    attendeeEmails = [],
    location,
  }: {
    summary: string;
    description?: string;
    start: Date;
    end: Date;
    attendeeEmails?: string[];
    location?: string;
  }
): Promise<CalendarEvent> {
  const res = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary,
      description,
      location,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      attendees: attendeeEmails.map((email) => ({ email })),
    },
  });

  const e = res.data;
  return {
    id: e.id ?? "",
    summary: e.summary ?? summary,
    description: e.description ?? undefined,
    start: new Date(e.start?.dateTime ?? e.start?.date ?? start),
    end: new Date(e.end?.dateTime ?? e.end?.date ?? end),
    attendees: (e.attendees ?? []).map((a) => a.email ?? "").filter(Boolean),
    location: e.location ?? undefined,
    htmlLink: e.htmlLink ?? undefined,
  };
}

// Check free/busy for a time range
export async function getFreeBusy(
  calendar: ReturnType<typeof google.calendar>,
  { start, end }: { start: Date; end: Date }
): Promise<Array<{ start: Date; end: Date }>> {
  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      items: [{ id: "primary" }],
    },
  });

  const busy = res.data.calendars?.["primary"]?.busy ?? [];
  return busy.map((b) => ({
    start: new Date(b.start ?? start),
    end: new Date(b.end ?? end),
  }));
}
