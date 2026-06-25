import { google } from "googleapis";
import { createHmac } from "crypto";
import { encryptString, decryptString } from "@/lib/crypto";
import { stripHtmlToText } from "@/lib/email-body";
import { prisma } from "@/lib/prisma";
import { syncConversationWorkItems } from "@/lib/agent/work-item-sync";
import {
  FLOWDESK_GMAIL_LABEL_NAMES,
  isFlowDeskGmailLabelName,
  type FlowDeskGmailLabelName,
} from "@/lib/gmail-labels";

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
  textBody: string;
  cleanSnippet: string;
  renderMode: "html" | "plainText" | "fallback";
  labelIds: string[];
  date: Date;
  rfc822MessageId: string;
};

function getHeader(
  headers: Array<{ name?: string | null; value?: string | null }>,
  name: string
): string {
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

type GmailPart = {
  mimeType?: string | null;
  body?: { data?: string | null; attachmentId?: string | null; size?: number | null } | null;
  headers?: Array<{ name?: string | null; value?: string | null }> | null;
  parts?: GmailPart[] | null;
};

// Raster MIME types safe to embed as data URIs (SVG is excluded — can carry script)
const SAFE_INLINE_IMAGE_TYPES = new Set([
  "image/png", "image/jpeg", "image/jpg", "image/gif",
  "image/webp", "image/bmp", "image/tiff", "image/ico",
]);
const MAX_CID_EMBED_BYTES = 2 * 1024 * 1024; // 2 MB total per message
const MAX_CID_SINGLE_BYTES = 512 * 1024;      // 512 KB per image

type InlineImagePart = {
  contentId: string;
  mimeType: string;
  data: string | null;
  attachmentId: string | null;
  size: number;
};

export function collectInlineImages(
  payload: GmailPart | null | undefined,
  images: InlineImagePart[],
  depth = 0
): void {
  if (!payload || depth > 12) return;

  const mime = (payload.mimeType ?? "").toLowerCase();
  if (SAFE_INLINE_IMAGE_TYPES.has(mime)) {
    const contentIdHeader = (payload.headers ?? []).find(
      (h) => h.name?.toLowerCase() === "content-id"
    );
    if (contentIdHeader?.value) {
      const contentId = contentIdHeader.value.trim().replace(/^<|>$/g, "");
      images.push({
        contentId,
        mimeType: mime,
        data: payload.body?.data ?? null,
        attachmentId: payload.body?.attachmentId ?? null,
        size: payload.body?.size ?? 0,
      });
    }
  }

  for (const part of payload.parts ?? []) {
    collectInlineImages(part, images, depth + 1);
  }
}

async function resolveInlineCids(
  html: string,
  payload: GmailPart | null | undefined,
  gmail: ReturnType<typeof google.gmail>,
  messageId: string
): Promise<string> {
  if (!html.includes("cid:")) return html;

  const inlineImages: InlineImagePart[] = [];
  collectInlineImages(payload, inlineImages);
  if (inlineImages.length === 0) return html;

  let totalBytes = 0;
  const cidMap = new Map<string, string>();

  for (const img of inlineImages) {
    try {
      let base64Data = img.data;

      if (!base64Data && img.attachmentId) {
        const estimatedSize = img.size;
        if (estimatedSize > MAX_CID_SINGLE_BYTES) continue;

        const res = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId,
          id: img.attachmentId,
        });
        base64Data = res.data.data ?? null;
      }

      if (!base64Data) continue;

      // Gmail uses base64url; convert to standard base64 for data URIs
      const standardBase64 = base64Data.replace(/-/g, "+").replace(/_/g, "/");
      const byteSize = Math.ceil(standardBase64.length * 0.75);
      if (byteSize > MAX_CID_SINGLE_BYTES || totalBytes + byteSize > MAX_CID_EMBED_BYTES) continue;
      totalBytes += byteSize;

      cidMap.set(img.contentId, `data:${img.mimeType};base64,${standardBase64}`);
    } catch {
      // Skip images that fail to fetch — broken image is better than a sync failure
    }
  }

  if (cidMap.size === 0) return html;

  return html.replace(/src=(["'])cid:([^"'>\s]+)\1/gi, (_match, quote, cid) => {
    const dataUri = cidMap.get(cid);
    return dataUri ? `src=${quote}${dataUri}${quote}` : _match;
  });
}

type ExtractedEmailBody = {
  htmlBody: string;
  textBody: string;
  cleanSnippet: string;
  renderMode: "html" | "plainText" | "fallback";
};

function decodePartData(data?: string | null): string {
  return data ? Buffer.from(data, "base64url").toString("utf8") : "";
}

function collectMimeBodies(
  payload: GmailPart | null | undefined,
  bodies: { html: string[]; text: string[] },
  depth = 0
): void {
  if (!payload || depth > 12) return;

  const mime = (payload.mimeType ?? "").toLowerCase();
  const decoded = decodePartData(payload.body?.data);

  if (decoded) {
    if (mime === "text/html" || (mime !== "text/plain" && /^\s*</.test(decoded))) {
      bodies.html.push(decoded);
    } else if (mime === "text/plain" || !mime || mime === "text") {
      bodies.text.push(decoded);
    }
  }

  for (const part of payload.parts ?? []) {
    collectMimeBodies(part, bodies, depth + 1);
  }
}

// Extracts the canonical received-email body model from Gmail's full MIME payload.
// Keeps HTML when available for visual rendering, while retaining readable text for AI/snippets.
function extractEmailBody(payload: GmailPart | null | undefined): ExtractedEmailBody {
  const bodies = { html: [] as string[], text: [] as string[] };
  collectMimeBodies(payload, bodies);

  const htmlBody = bodies.html.find((body) => body.trim())?.trim() ?? "";
  const textBody =
    bodies.text.find((body) => body.trim())?.trim() ??
    (htmlBody ? stripHtmlToText(htmlBody, 12000) : "");
  const renderMode = htmlBody ? "html" : textBody ? "plainText" : "fallback";
  const cleanSnippet = stripHtmlToText(htmlBody || textBody, 240);

  return {
    htmlBody,
    textBody,
    cleanSnippet,
    renderMode,
  };
}

function extractedBodyForPayload(payload: GmailPart | null | undefined): ExtractedEmailBody {
  const extracted = extractEmailBody(payload);
  return {
    ...extracted,
    cleanSnippet: extracted.cleanSnippet || stripHtmlToText(extracted.textBody || extracted.htmlBody, 240),
  }
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

  return Promise.all(
    (res.data.messages ?? []).map(async (msg) => {
      const headers = msg.payload?.headers ?? [];
      const extracted = extractedBodyForPayload(msg.payload);
      const resolvedHtml = extracted.htmlBody
        ? await resolveInlineCids(extracted.htmlBody, msg.payload, gmail, msg.id ?? "")
        : extracted.htmlBody;
      return {
        id: msg.id ?? "",
        threadId: msg.threadId ?? "",
        from: getHeader(headers, "From"),
        to: getHeader(headers, "To"),
        subject: getHeader(headers, "Subject"),
        body: resolvedHtml || extracted.textBody,
        textBody: extracted.textBody,
        cleanSnippet: extracted.cleanSnippet,
        renderMode: extracted.renderMode,
        labelIds: msg.labelIds ?? [],
        date: new Date(parseInt(msg.internalDate ?? "0")),
        rfc822MessageId: getHeader(headers, "Message-ID"),
      };
    })
  );
}

// Strips "Display Name <email@example.com>" → "email@example.com"
export function extractEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim().toLowerCase();
}

function isPrismaUniqueConflict(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "P2002";
}

async function findOrCreateEmailContact({
  tenantId,
  email,
  displayName,
}: {
  tenantId: string;
  email: string;
  displayName: string;
}) {
  const existing = await prisma.contact.findUnique({
    where: { tenantId_phoneE164: { tenantId, phoneE164: email } },
  });
  if (existing) return existing;

  try {
    return await prisma.contact.create({
      data: { tenantId, name: displayName || email, phoneE164: email },
    });
  } catch (err) {
    if (!isPrismaUniqueConflict(err)) throw err;
    const raced = await prisma.contact.findUnique({
      where: { tenantId_phoneE164: { tenantId, phoneE164: email } },
    });
    if (raced) return raced;
    throw err;
  }
}

async function upsertGmailMessage({
  conversationId,
  channelEmail,
  msg,
}: {
  conversationId: string;
  channelEmail: string;
  msg: GmailMessage;
}) {
  const providerMessageId = `gmail_${msg.id}`;
  const isOutbound = extractEmail(msg.from) === channelEmail.toLowerCase();
  const isRead = !msg.labelIds.includes("UNREAD");

  try {
    await prisma.message.upsert({
      where: { providerMessageId },
      create: {
        conversationId,
        direction: isOutbound ? "outbound" : "inbound",
        fromE164: msg.from,
        toE164: msg.to,
        body: msg.body || `[${msg.subject}]`,
        subject: msg.subject || null,
        providerMessageId,
        isRead,
        gmailLabelIds: msg.labelIds,
        createdAt: msg.date,
      },
      update: {
        gmailLabelIds: msg.labelIds,
        ...(isRead ? { isRead: true } : {}),
      },
    });
  } catch (err) {
    if (!isPrismaUniqueConflict(err)) throw err;
    const existing = await prisma.message.findUnique({
      where: { providerMessageId },
      select: { id: true, conversationId: true },
    });
    if (!existing) throw err;
  }
}

async function syncFetchedGmailThread({
  messages,
  threadId,
  channelId,
  tenantId,
  channelEmail,
}: {
  messages: GmailMessage[];
  threadId: string;
  channelId: string;
  tenantId: string;
  channelEmail: string;
}) {
  if (messages.length === 0) return null;

  const firstMsg = messages[0];
  const lastMsg = messages[messages.length - 1];
  const isFirstOutbound = extractEmail(firstMsg.from) === channelEmail.toLowerCase();
  const externalRaw = isFirstOutbound ? firstMsg.to : firstMsg.from;
  const externalEmail = extractEmail(externalRaw);
  const externalDisplayName = externalRaw.replace(/<[^>]+>/, "").trim() || externalEmail;
  const gmailUnread = messages.some((msg) => msg.labelIds.includes("UNREAD"));

  const contact = await findOrCreateEmailContact({
    tenantId,
    email: externalEmail,
    displayName: externalDisplayName,
  });

  const conversation = await prisma.conversation.upsert({
    where: { tenantId_channelId_externalThreadId: { tenantId, channelId, externalThreadId: threadId } },
    create: {
      tenantId,
      channelId,
      externalThreadId: threadId,
      contactId: contact.id,
      status: "needs_reply",
      gmailUnread,
      gmailRawState: {
        threadId,
        unread: gmailUnread,
        lastLabelIds: lastMsg.labelIds,
      },
      lastMessageAt: lastMsg.date,
    },
    update: {
      lastMessageAt: lastMsg.date,
      contactId: contact.id,
      gmailUnread,
      gmailRawState: {
        threadId,
        unread: gmailUnread,
        lastLabelIds: lastMsg.labelIds,
      },
    },
  });

  for (const msg of messages) {
    await upsertGmailMessage({ conversationId: conversation.id, channelEmail, msg });
  }

  syncConversationWorkItems({ tenantId, conversationId: conversation.id }).catch((err) => {
    console.warn("Failed to sync derived work items", {
      tenantId,
      conversationId: conversation.id,
      message: err instanceof Error ? err.message : "Unknown error",
    });
  });

  return conversation;
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

    try {
      const messages = await fetchThread(gmail, thread.id);
      const conversation = await syncFetchedGmailThread({
        messages,
        threadId: thread.id,
        channelId,
        tenantId,
        channelEmail: channel.emailAddress,
      });
      if (conversation) synced++;
    } catch (err) {
      console.warn("Failed to sync Gmail thread", {
        tenantId,
        channelId,
        threadId: thread.id,
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
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

const GMAIL_WRITEBACK_MAX_ATTEMPTS = 3;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown Gmail error";
}

function nextWritebackAttemptDate(attempts: number): Date {
  const delayMinutes = Math.min(60, 2 ** Math.max(0, attempts - 1));
  return new Date(Date.now() + delayMinutes * 60 * 1000);
}

export async function markGmailThreadRead(
  channelId: string,
  providerMessageIds: string[],
  queueContext?: { tenantId: string; conversationId: string }
): Promise<void> {
  const gmailIds = providerMessageIds
    .map((id) => id.match(/^gmail_(.+)$/)?.[1])
    .filter((id): id is string => Boolean(id));
  if (gmailIds.length === 0) return;

  const gmail = await getGmailClient(channelId);
  try {
    for (const id of gmailIds) {
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= GMAIL_WRITEBACK_MAX_ATTEMPTS; attempt++) {
        try {
          await gmail.users.messages.modify({
            userId: "me",
            id,
            requestBody: { removeLabelIds: ["UNREAD"] },
          });
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
        }
      }
      if (lastError) throw lastError;
    }
  } catch (err) {
    if (queueContext) {
      const message = errorMessage(err);
      await prisma.gmailWritebackQueue.upsert({
        where: {
          conversationId_action: {
            conversationId: queueContext.conversationId,
            action: "mark_read",
          },
        },
        create: {
          tenantId: queueContext.tenantId,
          channelId,
          conversationId: queueContext.conversationId,
          action: "mark_read",
          providerMessageIdsJson: providerMessageIds,
          attempts: 1,
          lastError: message,
          status: "pending",
          nextAttemptAt: nextWritebackAttemptDate(1),
        },
        update: {
          providerMessageIdsJson: providerMessageIds,
          attempts: { increment: 1 },
          lastError: message,
          status: "pending",
          nextAttemptAt: nextWritebackAttemptDate(2),
        },
      });
    }
    throw err;
  }
}

type GmailLabelRecord = {
  id?: string | null
  name?: string | null
}

async function listGmailLabels(
  gmail: ReturnType<typeof google.gmail>
): Promise<Map<string, string>> {
  const existing = await gmail.users.labels.list({ userId: "me" })
  const labelsByName = new Map<string, string>()

  for (const label of (existing.data.labels ?? []) as GmailLabelRecord[]) {
    if (label.name && label.id) labelsByName.set(label.name, label.id)
  }

  return labelsByName
}

async function getOrCreateFlowDeskLabelIds(
  gmail: ReturnType<typeof google.gmail>,
  existingLabelIdsByName: Map<string, string>,
  labelsToEnsure: FlowDeskGmailLabelName[]
): Promise<Map<FlowDeskGmailLabelName, string>> {
  const ids = new Map<FlowDeskGmailLabelName, string>()
  for (const labelName of labelsToEnsure) {
    const existingId = existingLabelIdsByName.get(labelName)
    if (existingId) {
      ids.set(labelName, existingId)
      continue
    }

    const created = await gmail.users.labels.create({
      userId: "me",
      requestBody: {
        name: labelName,
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      },
    })
    const createdId = created.data.id
    if (!createdId) throw new Error(`Gmail did not return an id for label ${labelName}`)
    existingLabelIdsByName.set(labelName, createdId)
    ids.set(labelName, createdId)
  }

  return ids
}

export async function applyFlowDeskLabelsToGmailThread(
  channelId: string,
  gmailThreadId: string,
  labels: FlowDeskGmailLabelName[]
): Promise<void> {
  const requestedLabels = Array.from(new Set(labels.filter(isFlowDeskGmailLabelName)))
  if (requestedLabels.length === 0) return

  const gmail = await getGmailClient(channelId)
  const existingLabelIdsByName = await listGmailLabels(gmail)
  const labelIds = await getOrCreateFlowDeskLabelIds(gmail, existingLabelIdsByName, requestedLabels)

  const addLabelIds = requestedLabels
    .map((label) => labelIds.get(label))
    .filter((id): id is string => Boolean(id))
  const removeLabelIds = FLOWDESK_GMAIL_LABEL_NAMES
    .filter((label) => !requestedLabels.includes(label))
    .map((label) => existingLabelIdsByName.get(label))
    .filter((id): id is string => Boolean(id))

  await gmail.users.threads.modify({
    userId: "me",
    id: gmailThreadId,
    requestBody: {
      addLabelIds,
      removeLabelIds,
    },
  })
}

export async function ensureFlowDeskLabels(channelId: string): Promise<void> {
  const gmail = await getGmailClient(channelId)
  const existingLabelIdsByName = await listGmailLabels(gmail)
  await getOrCreateFlowDeskLabelIds(gmail, existingLabelIdsByName, [...FLOWDESK_GMAIL_LABEL_NAMES])
}

// Removes the INBOX label from a thread (archive). The thread remains in All Mail.
export async function archiveGmailThread(channelId: string, gmailThreadId: string): Promise<void> {
  const gmail = await getGmailClient(channelId);
  await gmail.users.threads.modify({
    userId: "me",
    id: gmailThreadId,
    requestBody: { removeLabelIds: ["INBOX"] },
  });
}

// Moves a thread to Gmail Trash. The thread is NOT permanently deleted.
export async function trashGmailThread(channelId: string, gmailThreadId: string): Promise<void> {
  const gmail = await getGmailClient(channelId);
  await gmail.users.threads.trash({ userId: "me", id: gmailThreadId });
}

// ──────────────────────────────────────────────────────────────────────────────
// Gmail Incremental Sync & Push Notifications
// ──────────────────────────────────────────────────────────────────────────────

export type GmailHistoryRecord = {
  id: string;
  threadId: string;
  messagesAdded?: Array<{ message: { id: string; threadId: string } }>;
  messagesDeleted?: Array<{ message: { id: string; threadId?: string | null } }>;
  labelsAdded?: Array<{ message: { id: string; threadId?: string | null }; labelIds: string[] }>;
  labelsRemoved?: Array<{ message: { id: string; threadId?: string | null }; labelIds: string[] }>;
};

/**
 * Fetches the latest historyId from Gmail for the user.
 * Returns the current historyId to start watching from.
 */
export async function fetchLatestHistoryId(channelId: string): Promise<string | null> {
  const gmail = await getGmailClient(channelId);
  const profile = await gmail.users.getProfile({ userId: "me" });
  return profile.data.historyId ?? null;
}

/**
 * Incrementally syncs Gmail changes since the last historyId.
 * Uses the Gmail History API to fetch only changes since last sync.
 */
export async function syncGmailChannelIncremental(
  channelId: string,
  tenantId: string
): Promise<{ synced: number; newHistoryId: string | null }> {
  const cred = await prisma.gmailCredential.findUnique({ where: { channelId } });
  if (!cred) throw new Error("No Gmail credential found for channel");

  const gmail = await getGmailClient(channelId);
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel?.emailAddress) throw new Error("Not an email channel");

  const startHistoryId = cred.historyId ?? (await fetchLatestHistoryId(channelId));
  if (!startHistoryId) throw new Error("Could not determine starting historyId");

  let currentHistoryId = startHistoryId;
  let synced = 0;
  let pageToken: string | undefined;
  let processingErrors = 0;

  do {
    const historyRes = await gmail.users.history.list({
      userId: "me",
      startHistoryId,
      pageToken,
      maxResults: 100,
      labelId: "INBOX",
    });

    const history = historyRes.data.history ?? [];
    currentHistoryId = historyRes.data.historyId ?? currentHistoryId;
    pageToken = historyRes.data.nextPageToken ?? undefined;

    for (const record of history) {
      const threadIdsToRefresh = new Set<string>();

      if (record.messagesAdded) {
        for (const added of record.messagesAdded) {
          const message = added.message;
          if (message?.threadId) threadIdsToRefresh.add(message.threadId);
        }
      }

      if (record.messagesDeleted) {
        for (const deleted of record.messagesDeleted) {
          if (!deleted.message?.id) continue;
          await prisma.message.updateMany({
            where: { providerMessageId: `gmail_${deleted.message.id}` },
            data: { body: "[Message deleted]" },
          });
        }
      }

      if (record.labelsAdded) {
        for (const labelChange of record.labelsAdded) {
          if (labelChange.message?.threadId) threadIdsToRefresh.add(labelChange.message.threadId);
        }
      }

      if (record.labelsRemoved) {
        for (const labelChange of record.labelsRemoved) {
          if (!labelChange.message?.id) continue;
          if (labelChange.message.threadId) threadIdsToRefresh.add(labelChange.message.threadId);

          if (labelChange.labelIds?.includes("UNREAD")) {
            await prisma.message.updateMany({
              where: { providerMessageId: `gmail_${labelChange.message.id}` },
              data: { isRead: true },
            });
          }

          if (labelChange.labelIds?.includes("INBOX")) {
            await prisma.message.updateMany({
              where: { providerMessageId: `gmail_${labelChange.message.id}` },
              data: { body: "[Message removed from inbox]" },
            });
          }
        }
      }

      for (const threadId of threadIdsToRefresh) {
        try {
          await syncThreadFromHistory(gmail, threadId, channelId, tenantId, channel.emailAddress);
        } catch (err) {
          processingErrors++;
          console.warn("Failed to sync Gmail history thread", {
            tenantId,
            channelId,
            threadId,
            message: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }
    }

    synced += history.length;
  } while (pageToken);

  if (processingErrors > 0) {
    throw new Error(`Gmail incremental sync failed for ${processingErrors} changed thread${processingErrors === 1 ? "" : "s"}`);
  }

  // Update the historyId for next sync
  await prisma.gmailCredential.update({
    where: { channelId },
    data: { historyId: currentHistoryId, lastSyncedAt: new Date(), lastSyncError: null },
  });

  return { synced, newHistoryId: currentHistoryId };
}

/**
 * Helper to sync a thread from history (reusing existing thread sync logic)
 */
async function syncThreadFromHistory(
  gmail: ReturnType<typeof google.gmail>,
  threadId: string,
  channelId: string,
  tenantId: string,
  channelEmail: string
) {
  const messages = await fetchThread(gmail, threadId);
  await syncFetchedGmailThread({ messages, threadId, channelId, tenantId, channelEmail });
}

/**
 * Sets up Gmail push notifications (watch) for real-time updates.
 * Returns the watch expiration timestamp.
 */
export async function watchGmailChannel(
  channelId: string,
  topicName: string
): Promise<{ expiration: Date; historyId: string }> {
  const gmail = await getGmailClient(channelId);
  const cred = await prisma.gmailCredential.findUnique({ where: { channelId } });
  if (!cred) throw new Error("No Gmail credential found for channel");

  const currentHistoryId = cred.historyId ?? (await fetchLatestHistoryId(channelId));
  if (!currentHistoryId) throw new Error("Could not determine current historyId");

  const res = await gmail.users.watch({
    userId: "me",
    requestBody: {
      topicName,
      labelIds: ["INBOX"],
      labelFilterBehavior: "INCLUDE",
    },
  });

  const expirationMs = parseInt(res.data.expiration ?? "0");
  const expiration = expirationMs > 0 ? new Date(expirationMs) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const watchHistoryId = res.data.historyId ?? currentHistoryId;

  await prisma.gmailCredential.update({
    where: { channelId },
    data: {
      historyId: watchHistoryId,
      watchExpiresAt: expiration,
      watchLastRenewalAttempt: new Date(),
      watchRenewalError: null,
      lastSyncMode: "watch_renewal",
      lastSyncStatus: "success",
      lastSyncError: null,
    },
  });

  return { expiration, historyId: watchHistoryId };
}

/**
 * Stops the Gmail push notification watch.
 */
export async function stopGmailWatch(channelId: string): Promise<void> {
  const gmail = await getGmailClient(channelId);
  await gmail.users.stop({ userId: "me" });
}

/**
 * Renews the Gmail watch if it's about to expire.
 * Should be called from a cron job (e.g., daily).
 */
export async function renewGmailWatchIfNeeded(
  channelId: string,
  topicName: string
): Promise<boolean> {
  const cred = await prisma.gmailCredential.findUnique({ where: { channelId } });
  if (!cred) return false;

  const renewalWindow = 48 * 60 * 60 * 1000;
  if (cred.watchExpiresAt && cred.watchExpiresAt.getTime() - Date.now() > renewalWindow) {
    return false;
  }

  await watchGmailChannel(channelId, topicName);
  return true;
}

// ──────────────────────────────────────────────────────────────────────────────
// Google Calendar
// ──────────────────────────────────────────────────────────────────────────────

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
  {
    maxResults = 20,
    timeMin = new Date(),
    timeMax,
  }: { maxResults?: number; timeMin?: Date; timeMax?: Date } = {}
): Promise<CalendarEvent[]> {
  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: timeMin.toISOString(),
    ...(timeMax ? { timeMax: timeMax.toISOString() } : {}),
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
    status,
  }: {
    summary: string;
    description?: string;
    start: Date;
    end: Date;
    attendeeEmails?: string[];
    location?: string;
    status?: "confirmed" | "tentative" | "cancelled";
  }
): Promise<CalendarEvent> {
  const res = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary,
      description,
      location,
      status,
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

export async function deleteCalendarEvent(
  calendar: ReturnType<typeof google.calendar>,
  eventId: string
): Promise<void> {
  await calendar.events.delete({ calendarId: "primary", eventId });
}

export async function patchCalendarEventStatus(
  calendar: ReturnType<typeof google.calendar>,
  eventId: string,
  status: "confirmed" | "tentative" | "cancelled",
  summary?: string
): Promise<void> {
  await calendar.events.patch({
    calendarId: "primary",
    eventId,
    requestBody: { status, ...(summary ? { summary } : {}) },
  });
}

// Fetches recent sent messages from Gmail SENT label for reply-style training.
// Does not write to the DB — used only at training time.
export async function fetchGmailSentSamples(
  channelId: string,
  limit = 60
): Promise<Array<{ text: string; createdAt: Date }>> {
  const gmail = await getGmailClient(channelId);

  const listRes = await gmail.users.messages.list({
    userId: "me",
    labelIds: ["SENT"],
    maxResults: limit,
  });

  const messages = listRes.data.messages ?? [];
  const samples: Array<{ text: string; createdAt: Date }> = [];

  for (const msg of messages) {
    if (!msg.id) continue;
    try {
      const res = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "full",
      })
      const extracted = extractEmailBody(res.data.payload)
      const text = extracted.textBody || extracted.cleanSnippet
      const createdAt = new Date(parseInt(res.data.internalDate ?? "0"))
      if (text.trim()) {
        samples.push({ text, createdAt });
      }
    } catch {
      // Skip messages that cannot be fetched
    }
  }

  return samples;
}
