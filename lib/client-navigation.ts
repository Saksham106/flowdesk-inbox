export function getAuthSuccessPath(authResultUrl?: string | null): string {
  if (!authResultUrl) {
    return "/inbox";
  }

  if (authResultUrl.startsWith("/")) {
    return authResultUrl;
  }

  try {
    const url = new URL(authResultUrl);
    return `${url.pathname}${url.search}${url.hash}` || "/inbox";
  } catch {
    return "/inbox";
  }
}

export function scrollToLandingSection(
  href: string,
  doc: Document = document,
  historyApi: History = history
): boolean {
  if (!href.startsWith("#")) {
    return false;
  }

  const target = doc.getElementById(href.slice(1));
  if (!target) {
    return false;
  }

  target.scrollIntoView({ behavior: "smooth", block: "start" });
  historyApi.replaceState(null, "", "/");
  return true;
}

export function buildConversationHref(conversationId: string, returnTo?: string | null): string {
  if (!returnTo) {
    return `/conversations/${conversationId}`;
  }

  return `/conversations/${conversationId}?returnTo=${encodeURIComponent(returnTo)}`;
}

export function getSafeInboxReturnPath(returnTo?: string | null): string {
  if (!returnTo) {
    return "/inbox";
  }

  try {
    const url = returnTo.startsWith("/")
      ? new URL(returnTo, "https://flowdesk.local")
      : new URL(returnTo);

    if (url.pathname !== "/inbox") {
      return "/inbox";
    }

    return `${url.pathname}${url.search}`;
  } catch {
    return "/inbox";
  }
}
