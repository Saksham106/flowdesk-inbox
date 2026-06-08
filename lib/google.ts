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

function callbackUrl() {
  return `${process.env.NEXTAUTH_URL}/api/connectors/gmail/callback`;
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
