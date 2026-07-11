const QUOTED_THREAD_PATTERNS = [
  /^On .+ wrote:$/im,
  /^From:\s.+$/im,
  /^-{2,}\s*Original Message\s*-{2,}/im,
]

const AI_PREAMBLE_PATTERNS = [
  /^here'?s\s+a\s+draft\s+reply:?\s*/i,
  /^sure,?\s+here'?s\s+a\s+response:?\s*/i,
  /^draft:?\s*/i,
]

const PLACEHOLDER_PATTERN = /\[[a-z0-9 _'-]{2,40}\]|\{\{[^}]{1,40}\}\}/i
const MARKUP_PATTERN = /<[a-z][a-z0-9]*[^>]*>|\*\*[^*]+\*\*|`[^`]+`/i

const MIN_VIABLE_LENGTH = 12
const MAX_STRIP_FRACTION = 0.4

export type SanitizeDraftResult = {
  text: string
  autoFixed: string[]
  flagged: string[]
}

export function sanitizeDraftText(original: string): SanitizeDraftResult {
  const trimmedOriginal = original.trim()
  let working = trimmedOriginal
  const autoFixed: string[] = []

  const beforeQuoteStrip = working
  for (const pattern of QUOTED_THREAD_PATTERNS) {
    const match = working.match(pattern)
    if (match?.index !== undefined && match.index >= 0) {
      working = working.slice(0, match.index).trim()
    }
  }
  working = working
    .split("\n")
    .filter((line) => !line.trim().startsWith(">"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  if (working !== beforeQuoteStrip) autoFixed.push("quoted_thread")

  const beforePreambleStrip = working
  for (const pattern of AI_PREAMBLE_PATTERNS) {
    if (pattern.test(working)) {
      working = working.replace(pattern, "").trim()
      break
    }
  }
  if (working !== beforePreambleStrip) autoFixed.push("ai_preamble")

  const strippedFraction =
    trimmedOriginal.length === 0 ? 0 : 1 - working.length / trimmedOriginal.length

  const flagged: string[] = []
  if (working.length < MIN_VIABLE_LENGTH) {
    flagged.push("empty_after_strip")
  }
  if (PLACEHOLDER_PATTERN.test(working)) {
    flagged.push("unresolved_placeholder")
  }
  if (MARKUP_PATTERN.test(working)) {
    flagged.push("markup_artifact")
  }

  // Only abort stripping if BOTH the fraction is high AND the result is suspiciously short.
  // A short reply to a long quoted thread (high fraction stripped, reasonable length remaining)
  // is normal and should not be treated as over-aggressive stripping.
  if (strippedFraction > MAX_STRIP_FRACTION && working.length <= MIN_VIABLE_LENGTH) {
    // Include both flags if both conditions apply
    if (!flagged.includes("strip_too_aggressive")) {
      flagged.push("strip_too_aggressive")
    }
    return { text: trimmedOriginal, autoFixed: [], flagged }
  }

  return { text: working, autoFixed, flagged }
}
