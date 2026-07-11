/** A timestamped override also represents an explicit clear-label action. */
export function hasGmailLabelOverride(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false
  const override = (metadata as Record<string, unknown>).gmailLabelOverride
  if (!override || typeof override !== "object" || Array.isArray(override)) return false
  const value = override as Record<string, unknown>
  return (
    typeof value.workflow === "string" ||
    typeof value.contentType === "string" ||
    typeof value.updatedAt === "string"
  )
}
