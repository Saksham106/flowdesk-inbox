export type HomeApprovalInput = {
  id: string
  conversationId: string | null
  title: string
  subtitle: string
  createdAt: Date
}

export type HomeConversationInput = {
  id: string
  title: string
  subtitle: string
  lastMessageAt: Date
}

export type HomeDeadlineInput = {
  taskId: string
  conversationId: string
  title: string
  subtitle: string
  href: string
  dueAt: Date | null
}

export type HomeActionItem =
  | {
      key: `approval:${string}`
      kind: "approval"
      title: string
      subtitle: string
      href: string
      canComplete: false
    }
  | {
      key: `conversation:${string}`
      kind: "reply" | "action" | "follow_up"
      conversationId: string
      title: string
      subtitle: string
      href: string
      canComplete: true
    }
  | {
      key: `task:${string}`
      kind: "deadline"
      taskId: string
      conversationId: string
      title: string
      subtitle: string
      href: string
      canComplete: true
    }

export type HomeActionFeedInput = {
  approvals: HomeApprovalInput[]
  topActions: HomeConversationInput[]
  needsAction: HomeConversationInput[]
  deadlines: HomeDeadlineInput[]
  followUps: HomeConversationInput[]
  now: Date
}

export function buildHomeActionFeed(input: HomeActionFeedInput): {
  items: HomeActionItem[]
  total: number
} {
  const seenConversations = new Set<string>()
  const seenTasks = new Set<string>()
  const items: HomeActionItem[] = []

  for (const approval of [...input.approvals].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  )) {
    if (approval.conversationId && seenConversations.has(approval.conversationId)) continue
    if (approval.conversationId) seenConversations.add(approval.conversationId)
    items.push({
      key: `approval:${approval.id}`,
      kind: "approval",
      title: approval.title,
      subtitle: approval.subtitle,
      href: "/approvals",
      canComplete: false,
    })
  }

  appendConversations(items, seenConversations, input.topActions, "reply")

  const deadlines = [...input.deadlines]
    .filter((item) => item.dueAt)
    .sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0))
  appendDeadlines(
    items,
    seenConversations,
    seenTasks,
    deadlines.filter((item) => item.dueAt && item.dueAt < input.now)
  )

  appendConversations(items, seenConversations, input.needsAction, "action")
  appendDeadlines(
    items,
    seenConversations,
    seenTasks,
    deadlines.filter((item) => item.dueAt && item.dueAt >= input.now)
  )
  appendConversations(items, seenConversations, input.followUps, "follow_up")

  return { items: items.slice(0, 10), total: items.length }
}

function appendConversations(
  target: HomeActionItem[],
  seenConversations: Set<string>,
  conversations: HomeConversationInput[],
  kind: "reply" | "action" | "follow_up"
) {
  for (const conversation of conversations) {
    if (seenConversations.has(conversation.id)) continue
    seenConversations.add(conversation.id)
    target.push({
      key: `conversation:${conversation.id}`,
      kind,
      conversationId: conversation.id,
      title: conversation.title,
      subtitle: conversation.subtitle,
      href: `/conversations/${conversation.id}`,
      canComplete: true,
    })
  }
}

function appendDeadlines(
  target: HomeActionItem[],
  seenConversations: Set<string>,
  seenTasks: Set<string>,
  deadlines: HomeDeadlineInput[]
) {
  for (const deadline of deadlines) {
    if (seenTasks.has(deadline.taskId) || seenConversations.has(deadline.conversationId)) continue
    seenTasks.add(deadline.taskId)
    seenConversations.add(deadline.conversationId)
    target.push({
      key: `task:${deadline.taskId}`,
      kind: "deadline",
      taskId: deadline.taskId,
      conversationId: deadline.conversationId,
      title: deadline.title,
      subtitle: deadline.subtitle,
      href: deadline.href,
      canComplete: true,
    })
  }
}
