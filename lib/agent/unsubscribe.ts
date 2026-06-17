export type UnsubscribeInfo = {
  hasUnsubscribeLink: boolean
  unsubscribeUrl: string | null
}

const BODY_UNSUBSCRIBE_PATTERN =
  /href=["'](https?:\/\/[^"']*(?:unsubscribe|optout|opt-out|opt_out|remove)[^"']*)/i

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/i,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
]

export function extractListUnsubscribeHeader(rawText: string): string | null {
  const match = rawText.match(/^list-unsubscribe:\s*(.+)$/im)
  return match?.[1]?.trim() ?? null
}

export function isSafeUnsubscribeUrl(rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return false
  if (url.username || url.password) return false

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (!hostname || hostname.endsWith(".local")) return false
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) return false

  return true
}

export function parseUnsubscribeInfo(
  listUnsubscribeHeader: string | null,
  bodyHtml: string
): UnsubscribeInfo {
  // Parse List-Unsubscribe header — only accept https:// URLs, skip mailto:
  if (listUnsubscribeHeader) {
    const urlMatch = listUnsubscribeHeader.match(/<(https?:\/\/[^>]+)>/)
    if (urlMatch && isSafeUnsubscribeUrl(urlMatch[1])) {
      return { hasUnsubscribeLink: true, unsubscribeUrl: urlMatch[1] }
    }
  }

  // Fall back to body scan
  const bodyMatch = bodyHtml.match(BODY_UNSUBSCRIBE_PATTERN)
  if (bodyMatch && isSafeUnsubscribeUrl(bodyMatch[1])) {
    return { hasUnsubscribeLink: true, unsubscribeUrl: bodyMatch[1] }
  }

  return { hasUnsubscribeLink: false, unsubscribeUrl: null }
}
