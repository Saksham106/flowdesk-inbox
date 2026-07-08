import { redirect } from "next/navigation"

// The standalone search page's message-body search is now built into Home's
// search box (AppListColumn / app/inbox/page.tsx's mobile query both match
// message body content too), so a bookmark or link to /search just lands on
// Home with the same query instead of a second, disconnected search UI.
export default function SearchPage({
  searchParams,
}: {
  searchParams: { q?: string }
}) {
  const q = searchParams.q?.trim()
  redirect(q ? `/inbox?q=${encodeURIComponent(q)}` : "/inbox")
}
