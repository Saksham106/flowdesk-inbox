import type {
  BusinessProfile,
  KnowledgeDocument,
  LearnedReplyProfile,
  PersonMemory,
  ConversationState,
} from "@prisma/client"

import { prisma } from "@/lib/prisma"

export type AccountTypeValue = "personal" | "business"

export type ReplyGenerationContext = {
  accountType: AccountTypeValue
  businessProfile: BusinessProfile | null
  knowledgeDocuments: KnowledgeDocument[]
  learnedProfile: LearnedReplyProfile | null
  personMemory: PersonMemory | null
  conversationState: ConversationState | null
}

export async function getReplyGenerationContext(input: {
  tenantId: string
  channelId?: string | null
  conversationId?: string | null
  contactId?: string | null
}): Promise<ReplyGenerationContext> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: input.tenantId },
    select: { accountType: true },
  })

  const accountType = tenant?.accountType === "personal" ? "personal" : "business"
  const profileType = accountType

  const learnedProfilePromise = prisma.learnedReplyProfile.findFirst({
    where: {
      tenantId: input.tenantId,
      ...(input.channelId ? { channelId: input.channelId } : {}),
      profileType,
    },
    orderBy: { updatedAt: "desc" },
  })

  // Fetch PersonMemory if we have a contactId
  const personMemoryPromise = input.contactId
    ? prisma.personMemory.findUnique({ where: { contactId: input.contactId } })
    : Promise.resolve(null)

  // Fetch ConversationState if we have a conversationId
  const conversationStatePromise = input.conversationId
    ? prisma.conversationState.findUnique({ where: { conversationId: input.conversationId } })
    : Promise.resolve(null)

  if (accountType === "personal") {
    const [learnedProfile, personMemory, conversationState] = await Promise.all([
      learnedProfilePromise,
      personMemoryPromise,
      conversationStatePromise,
    ])

    return {
      accountType,
      businessProfile: null,
      knowledgeDocuments: [],
      learnedProfile,
      personMemory,
      conversationState,
    }
  }

  const [businessProfile, knowledgeDocuments, learnedProfile, personMemory, conversationState] = await Promise.all([
    prisma.businessProfile.findUnique({ where: { tenantId: input.tenantId } }),
    prisma.knowledgeDocument.findMany({
      where: { tenantId: input.tenantId, NOT: { sourceType: "concierge_template" } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    learnedProfilePromise,
    personMemoryPromise,
    conversationStatePromise,
  ])

  return {
    accountType,
    businessProfile,
    knowledgeDocuments,
    learnedProfile,
    personMemory,
    conversationState,
  }
}
