import { prisma } from "@/lib/prisma"
import { extractEmail, fetchThread, getGmailClient, sendGmailReply } from "@/lib/google"
import { sendOutlookReply } from "@/lib/microsoft"
import { conversationUpdateForWorkflowStatus } from "@/lib/workflow-status-transitions"

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

  if (conversation.channel.type !== "email") {
    throw new ConversationSendError("Only email channels are supported", 400)
  }

  return sendEmailConversationMessage({
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

  // For Outlook channels, route through Microsoft Graph
  if (conversation.channel.provider === "microsoft") {
    return sendOutlookEmailMessage({ conversation, text, userId, auditAction })
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
        data: {
          lastMessageAt: now,
          ...conversationUpdateForWorkflowStatus("waiting_on", now),
        },
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

async function sendOutlookEmailMessage({
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
  const channelEmail = conversation.channel.emailAddress
  if (!channelEmail) {
    throw new ConversationSendError("Channel has no email address", 500)
  }

  const recipientEmail = conversation.contact?.phoneE164 ?? ""
  if (!recipientEmail) {
    throw new ConversationSendError("Cannot determine recipient email address", 400)
  }

  let outlookMsgId: string
  try {
    outlookMsgId = await sendOutlookReply({
      channelId: conversation.channelId,
      to: recipientEmail,
      subject: "Re: message",
      body: text,
      conversationId: conversation.externalThreadId,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Outlook send error"
    console.error("[send/outlook] error:", err)
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
          providerMessageId: `outlook_${outlookMsgId}`,
          createdAt: now,
        },
      }),
      prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: now,
          ...conversationUpdateForWorkflowStatus("waiting_on", now),
        },
      }),
      prisma.auditLog.create({
        data: {
          tenantId: conversation.tenantId,
          userId,
          action: auditAction,
          payloadJson: {
            conversationId: conversation.id,
            outlookMsgId,
            to: recipientEmail,
            channel: "outlook",
          },
        },
      }),
    ])
  } catch (err) {
    console.error("[send/outlook] DB error after send (id=%s):", outlookMsgId, err)
    throw new ConversationSendError("Email sent but failed to save - refresh the page.", 500)
  }

  return { ok: true, providerMessageId: `outlook_${outlookMsgId}` }
}
