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
