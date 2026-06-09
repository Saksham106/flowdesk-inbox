import { prisma } from "@/lib/prisma"
import { getTwilioClient } from "@/lib/twilio"
import { extractEmail, fetchThread, getGmailClient, sendGmailReply } from "@/lib/google"

type ConversationForSend = NonNullable<
  Awaited<
    ReturnType<
      typeof prisma.conversation.findFirst<{
        include: {
          channel: true
          contact: true
        }
      }>
    >
  >
>

export class ConversationSendError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export type SendConversationMessageInput = {
  conversationId: string
  tenantId: string
  userId?: string | null
  text: string
  auditAction?: string
}

export type SendConversationMessageResult = {
  ok: true
  providerMessageId: string
}

export async function sendConversationMessage(
  input: SendConversationMessageInput
): Promise<SendConversationMessageResult> {
  const text = input.text.trim()
  if (!text) {
    throw new ConversationSendError("Message text is required", 400)
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: input.conversationId,
      tenantId: input.tenantId,
    },
    include: {
      channel: true,
      contact: true,
    },
  })

  if (!conversation) {
    throw new ConversationSendError("Conversation not found", 404)
  }

  if (conversation.channel.type === "email") {
    return sendEmailConversationMessage({
      conversation,
      text,
      userId: input.userId,
      auditAction: input.auditAction ?? "conversation.send",
    })
  }

  return sendSmsConversationMessage({
    conversation,
    text,
    userId: input.userId,
    auditAction: input.auditAction ?? "conversation.send",
  })
}

async function sendEmailConversationMessage({
  conversation,
  text,
  userId,
  auditAction,
}: {
  conversation: ConversationForSend
  text: string
  userId?: string | null
  auditAction: string
}): Promise<SendConversationMessageResult> {
  if (!conversation) {
    throw new ConversationSendError("Conversation not found", 404)
  }

  const channelEmail = conversation.channel.emailAddress
  if (!channelEmail) {
    throw new ConversationSendError("Channel has no email address", 500)
  }

  let recipientEmail = conversation.contact?.phoneE164 ?? ""

  let gmail: Awaited<ReturnType<typeof getGmailClient>>
  try {
    gmail = await getGmailClient(conversation.channelId)
  } catch {
    throw new ConversationSendError("Gmail not connected", 503)
  }

  let subject = "No subject"
  let inReplyTo: string | undefined
  let references: string | undefined

  try {
    const messages = await fetchThread(gmail, conversation.externalThreadId)
    if (messages.length > 0) {
      subject = messages[0].subject
      const lastMsg = messages[messages.length - 1]
      inReplyTo = lastMsg.rfc822MessageId || undefined
      references = lastMsg.rfc822MessageId || undefined
      if (!recipientEmail) {
        const lastInbound = [...messages]
          .reverse()
          .find((message) => extractEmail(message.from) !== channelEmail.toLowerCase())
        recipientEmail = lastInbound ? extractEmail(lastInbound.from) : ""
      }
    }
  } catch (err) {
    console.error("[send/email] failed to fetch thread:", err)
    throw new ConversationSendError("Failed to fetch thread info from Gmail", 502)
  }

  if (!recipientEmail) {
    throw new ConversationSendError("Cannot determine recipient email address", 400)
  }

  let gmailMessageId: string
  try {
    gmailMessageId = await sendGmailReply(gmail, {
      to: recipientEmail,
      from: channelEmail,
      subject,
      body: text,
      threadId: conversation.externalThreadId,
      inReplyTo,
      references,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gmail send error"
    console.error("[send/email] Gmail error:", err)
    throw new ConversationSendError(message, 502)
  }

  const now = new Date()
  try {
    await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: "outbound",
          fromE164: channelEmail,
          toE164: recipientEmail,
          body: text,
          providerMessageId: `gmail_${gmailMessageId}`,
          createdAt: now,
        },
      }),
      prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now, status: "in_progress" },
      }),
      prisma.auditLog.create({
        data: {
          tenantId: conversation.tenantId,
          userId,
          action: auditAction,
          payloadJson: {
            conversationId: conversation.id,
            gmailMessageId,
            to: recipientEmail,
            channel: "email",
          },
        },
      }),
    ])
  } catch (err) {
    console.error("[send/email] DB error after Gmail send (id=%s):", gmailMessageId, err)
    throw new ConversationSendError("Email sent but failed to save - refresh the page.", 500)
  }

  return { ok: true, providerMessageId: `gmail_${gmailMessageId}` }
}

async function sendSmsConversationMessage({
  conversation,
  text,
  userId,
  auditAction,
}: {
  conversation: ConversationForSend
  text: string
  userId?: string | null
  auditAction: string
}): Promise<SendConversationMessageResult> {
  if (!conversation) {
    throw new ConversationSendError("Conversation not found", 404)
  }

  const phoneNumber = conversation.channel.phoneNumberE164
  if (!phoneNumber) {
    throw new ConversationSendError("Channel has no phone number", 500)
  }

  const client = getTwilioClient(
    conversation.channel.twilioAccountSid,
    conversation.channel.twilioAuthTokenEncrypted
  )

  let result: Awaited<ReturnType<typeof client.messages.create>>

  try {
    result = await client.messages.create({
      from: phoneNumber,
      to: conversation.externalThreadId,
      body: text,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Twilio error"
    console.error("[send] Twilio error:", err)
    throw new ConversationSendError(message, 502)
  }

  try {
    const now = new Date()

    await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: "outbound",
          fromE164: phoneNumber,
          toE164: conversation.externalThreadId,
          body: text,
          providerMessageId: result.sid,
          createdAt: now,
        },
      }),
      prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now, status: "in_progress" },
      }),
      prisma.auditLog.create({
        data: {
          tenantId: conversation.tenantId,
          userId,
          action: auditAction,
          payloadJson: {
            conversationId: conversation.id,
            messageSid: result.sid,
            to: conversation.externalThreadId,
          },
        },
      }),
    ])
  } catch (err) {
    console.error("[send] DB error after successful Twilio send (sid=%s):", result.sid, err)
    throw new ConversationSendError("Message sent but failed to save - refresh the page.", 500)
  }

  return { ok: true, providerMessageId: result.sid }
}
