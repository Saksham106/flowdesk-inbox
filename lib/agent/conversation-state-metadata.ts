export type DenormalizedConversationStateMetadata = {
  attentionCategory: string | null
  emailType: string | null
  isSalesLead: boolean
  isSupport: boolean
}

export function denormalizeConversationStateMetadata(
  metadataJson: unknown
): DenormalizedConversationStateMetadata {
  const meta =
    metadataJson && typeof metadataJson === "object" && !Array.isArray(metadataJson)
      ? (metadataJson as Record<string, unknown>)
      : {}

  return {
    attentionCategory:
      typeof meta.attentionCategory === "string" ? meta.attentionCategory : null,
    emailType: typeof meta.emailType === "string" ? meta.emailType : null,
    isSalesLead: meta.isSalesLead === true,
    isSupport: meta.isSupport === true,
  }
}

export function conversationStateMetadataData(metadataJson: unknown): DenormalizedConversationStateMetadata {
  return denormalizeConversationStateMetadata(metadataJson)
}
