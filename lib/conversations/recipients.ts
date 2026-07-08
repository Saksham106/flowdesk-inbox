// Validation for user-supplied CC/BCC recipient lists. These values end up in
// raw RFC 2822 headers, so beyond format checks this guards against header
// injection (CR/LF smuggled into an address).

export const MAX_RECIPIENTS_PER_FIELD = 25

// Pragmatic address check: one non-whitespace local part, "@", a dot-separated
// domain. Deliberately rejects display-name forms ("Name <a@b.c>") — the
// compose UI collects bare addresses.
const EMAIL_PATTERN = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/

export class RecipientValidationError extends Error {}

// Normalizes a raw cc/bcc payload value into a deduped, lowercased list of
// valid addresses. Accepts an array of strings (blank entries are dropped);
// anything else non-nullish, an invalid address, or an oversized list throws.
export function normalizeRecipientList(raw: unknown, field: string): string[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    throw new RecipientValidationError(`${field} must be a list of email addresses`)
  }

  const seen = new Set<string>()
  for (const entry of raw) {
    if (typeof entry !== "string") {
      throw new RecipientValidationError(`${field} must be a list of email addresses`)
    }
    const trimmed = entry.trim()
    if (!trimmed) continue
    const normalized = trimmed.toLowerCase()
    if (/[\r\n]/.test(entry) || !EMAIL_PATTERN.test(normalized)) {
      throw new RecipientValidationError(`Invalid ${field} address: ${trimmed.slice(0, 100)}`)
    }
    seen.add(normalized)
  }

  if (seen.size > MAX_RECIPIENTS_PER_FIELD) {
    throw new RecipientValidationError(`Too many ${field} recipients (max ${MAX_RECIPIENTS_PER_FIELD})`)
  }

  return [...seen]
}
