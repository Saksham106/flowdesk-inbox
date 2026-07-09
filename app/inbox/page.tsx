import { redirect } from "next/navigation"

interface Props {
  searchParams: Record<string, string | string[] | undefined>
}

export default function InboxRedirect({ searchParams }: Props) {
  const isListView =
    !!searchParams.status || !!searchParams.q || !!searchParams.sales ||
    !!searchParams.attention || !!searchParams.type || !!searchParams.page
  if (!isListView) redirect("/home")
  // Repeated query keys arrive as string[]; take the first value so a param
  // can't get coerced into a comma-joined string.
  const qs = new URLSearchParams(
    Object.entries(searchParams)
      .filter(([, v]) => v != null)
      .map(([k, v]) => [k, Array.isArray(v) ? v[0] : v] as [string, string]),
  ).toString()
  redirect(qs ? `/mail?${qs}` : "/mail")
}
