import type {
  BusinessProfile,
  KnowledgeDocument,
  LearnedReplyProfile,
} from "@prisma/client"

import { prisma } from "@/lib/prisma"

export type AccountTypeValue = "personal" | "business"

export type ReplyGenerationContext = {
  accountType: AccountTypeValue
  businessProfile: BusinessProfile | null
  knowledgeDocuments: KnowledgeDocument[]
  learnedProfile: LearnedReplyProfile | null
}

export async function getReplyGenerationContext(input: {
  tenantId: string
  channelId?: string | null
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

  if (accountType === "personal") {
    return {
      accountType,
      businessProfile: null,
      knowledgeDocuments: [],
      learnedProfile: await learnedProfilePromise,
    }
  }

  const [businessProfile, knowledgeDocuments, learnedProfile] = await Promise.all([
    prisma.businessProfile.findUnique({ where: { tenantId: input.tenantId } }),
    prisma.knowledgeDocument.findMany({
      where: { tenantId: input.tenantId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    learnedProfilePromise,
  ])

  return {
    accountType,
    businessProfile,
    knowledgeDocuments,
    learnedProfile,
  }
}
