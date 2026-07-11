export const CLEANUP_RANGE_OPTIONS = [
  { value: "week", label: "Past week" },
  { value: "month", label: "Past month" },
  { value: "quarter", label: "Past 3 months" },
  { value: "half_year", label: "Past 6 months" },
  { value: "all", label: "All synced mail" },
] as const

export type CleanupRange = (typeof CLEANUP_RANGE_OPTIONS)[number]["value"]

const VALUES = new Set<string>(CLEANUP_RANGE_OPTIONS.map((option) => option.value))

export function parseCleanupRange(value: string | undefined): CleanupRange {
  return value && VALUES.has(value) ? (value as CleanupRange) : "quarter"
}

export function cleanupRangeCutoff(range: CleanupRange, now = new Date()): Date | null {
  if (range === "all") return null
  const cutoff = new Date(now)
  if (range === "week") cutoff.setUTCDate(cutoff.getUTCDate() - 7)
  else if (range === "month") cutoff.setUTCMonth(cutoff.getUTCMonth() - 1)
  else if (range === "quarter") cutoff.setUTCMonth(cutoff.getUTCMonth() - 3)
  else cutoff.setUTCMonth(cutoff.getUTCMonth() - 6)
  return cutoff
}
