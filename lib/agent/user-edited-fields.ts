/**
 * User-vs-system field ownership for InboxTask (audit P1-5).
 *
 * A user edit records the field name in `metadataJson.userEditedFields` (and
 * flips `source` to "user"); work-item sync then skips those fields when it
 * refreshes the task, so an explicit user correction is never clobbered by the
 * next sync/classification pass. Mirrors how ConversationState honors
 * `source: "user_override"` and how Lead updates omit `stage`/`score`.
 */

export function userEditedFieldsFromMetadata(metadataJson: unknown): string[] {
  if (!metadataJson || typeof metadataJson !== "object" || Array.isArray(metadataJson)) return []
  const value = (metadataJson as Record<string, unknown>).userEditedFields
  return Array.isArray(value) ? value.filter((f): f is string => typeof f === "string") : []
}

/** Returns metadata with `field` recorded as user-edited, preserving other keys. */
export function metadataWithUserEditedField(
  metadataJson: unknown,
  field: string
): Record<string, unknown> {
  const meta =
    metadataJson && typeof metadataJson === "object" && !Array.isArray(metadataJson)
      ? { ...(metadataJson as Record<string, unknown>) }
      : {}
  meta.userEditedFields = Array.from(new Set([...userEditedFieldsFromMetadata(metadataJson), field]))
  return meta
}
