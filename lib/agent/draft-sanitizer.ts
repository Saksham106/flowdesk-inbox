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

// Matches list-like lines: "- item", "* item", "1. item" (with optional leading
// whitespace). These lines must keep their own line break rather than being
// joined into the surrounding prose.
const LIST_LINE_PATTERN = /^\s*([-*]|\d+\.)\s+/

// Hard-wrapped lines from old plaintext email clients land close to a fixed
// column width (typically 70-80 chars). A short line — a greeting ("Hi
// Jane,"), a signoff ("Thanks,"), or a signature name — is very unlikely to
// be a mid-sentence wrap point, so it must not be joined into the next line.
// Only a line at or above this length is treated as a plausible wrap
// continuation.
const WRAP_CONTINUATION_MIN_LENGTH = 50

// A short line ending in "," or ":" is almost always an intentional break —
// a signoff ("Best regards,"), a greeting ("Dear Jane,"), or a list lead-in
// ("Here are the options:") — even when the line above it is long enough to
// look like a wrap point. A genuine mid-wrap fragment that short would end
// mid-sentence, not on trailing punctuation like this.
function isIntentionalBreakLine(trimmed: string): boolean {
  return trimmed.length < WRAP_CONTINUATION_MIN_LENGTH && /[,:]$/.test(trimmed)
}

/**
 * Undoes model-generated "hard wrap" line breaks — some models still write
 * plaintext email replies with a literal `\n` roughly every 70-80 characters,
 * a convention from old plaintext email clients. Embedded verbatim into an
 * outgoing MIME body, every one of those newlines renders as a real line
 * break in Gmail, splitting sentences mid-way.
 *
 * This joins consecutive non-blank, non-list lines with a single space
 * (undoing the hard wrap) while preserving:
 * - blank-line paragraph breaks (`\n\n` stays a real paragraph break),
 * - list-like lines (`-`, `*`, or `1.` bullets), which keep their own line
 *   break before and after so lists aren't flattened into prose, and
 * - short lines (below `WRAP_CONTINUATION_MIN_LENGTH`), which are far more
 *   likely to be an intentional greeting/signoff break than a wrap point —
 *   e.g. "Thanks,\nJane" keeps its line break instead of becoming
 *   "Thanks, Jane", and
 * - short lines ending in "," or ":" (see isIntentionalBreakLine), so a
 *   signoff after a long body line isn't glued onto the paragraph —
 *   "…see you then.\nBest regards," keeps its line break.
 */
export function unwrapHardWrappedText(text: string): string {
  const lines = text.split("\n")
  const outputLines: string[] = []
  let buffer: string[] = []

  const flush = () => {
    if (buffer.length > 0) {
      outputLines.push(buffer.join(" "))
      buffer = []
    }
  }

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    if (trimmed === "") {
      flush()
      outputLines.push("")
    } else if (LIST_LINE_PATTERN.test(rawLine)) {
      flush()
      outputLines.push(trimmed)
    } else {
      const previous = buffer[buffer.length - 1]
      if (
        buffer.length > 0 &&
        (previous.length < WRAP_CONTINUATION_MIN_LENGTH || isIntentionalBreakLine(trimmed))
      ) {
        // Either the line before this one was short (almost certainly an
        // intentional greeting/signoff break, not a wrap point), or this
        // line itself is a signoff/lead-in ("Best regards,") that must not
        // be glued onto the paragraph above it. Start a new line instead of
        // joining.
        flush()
      }
      buffer.push(trimmed)
    }
  }
  flush()

  return outputLines.join("\n")
}
