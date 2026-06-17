export type UnsubscribeInfo = {
  hasUnsubscribeLink: boolean
  unsubscribeUrl: string | null
}

const BODY_UNSUBSCRIBE_PATTERN =
  /href=["'](https?:\/\/[^"']*(?:unsubscribe|optout|opt-out|opt_out|remove)[^"']*)/i

export function parseUnsubscribeInfo(
  listUnsubscribeHeader: string | null,
  bodyHtml: string
): UnsubscribeInfo {
  // Parse List-Unsubscribe header — only accept https:// URLs, skip mailto:
  if (listUnsubscribeHeader) {
    const urlMatch = listUnsubscribeHeader.match(/<(https?:\/\/[^>]+)>/)
    if (urlMatch) {
      return { hasUnsubscribeLink: true, unsubscribeUrl: urlMatch[1] }
    }
  }

  // Fall back to body scan
  const bodyMatch = bodyHtml.match(BODY_UNSUBSCRIBE_PATTERN)
  if (bodyMatch) {
    return { hasUnsubscribeLink: true, unsubscribeUrl: bodyMatch[1] }
  }

  return { hasUnsubscribeLink: false, unsubscribeUrl: null }
}
