export const SOURCE_TYPE_OPTIONS = [
  { value: "faq", label: "FAQ" },
  { value: "service", label: "Service" },
  { value: "policy", label: "Policy" },
  { value: "pricing", label: "Pricing" },
  { value: "prep_instructions", label: "Prep Instructions" },
  { value: "cancellation", label: "Cancellation" },
  { value: "webpage", label: "Webpage" },
  { value: "other", label: "Other" },
] as const

export const VALID_SOURCE_TYPES = SOURCE_TYPE_OPTIONS.map((o) => o.value)
export type SourceType = (typeof SOURCE_TYPE_OPTIONS)[number]["value"]

export function isValidSourceType(value: string): value is SourceType {
  return (VALID_SOURCE_TYPES as readonly string[]).includes(value)
}
