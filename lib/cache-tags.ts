import { revalidatePath, revalidateTag } from "next/cache"

export function inboxTag(tenantId: string): string {
  return `inbox-${tenantId}`
}

export function conversationTag(conversationId: string): string {
  return `conversation-${conversationId}`
}

export function revalidateInboxViews(tenantId: string, conversationId?: string): void {
  try {
    revalidateTag(inboxTag(tenantId))
    revalidatePath("/inbox")
    if (conversationId) {
      revalidateTag(conversationTag(conversationId))
      revalidatePath(`/conversations/${conversationId}`)
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("static generation store missing")) {
      return
    }
    throw err
  }
}
