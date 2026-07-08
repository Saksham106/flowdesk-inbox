import { redirect } from "next/navigation"

interface Props {
  searchParams: { status?: string; q?: string; sales?: string; attention?: string; type?: string; page?: string }
}

export default function InboxRedirect({ searchParams }: Props) {
  const isListView =
    !!searchParams.status || !!searchParams.q || !!searchParams.sales ||
    !!searchParams.attention || !!searchParams.type || !!searchParams.page
  if (!isListView) redirect("/home")
  const qs = new URLSearchParams(
    Object.entries(searchParams).filter(([, v]) => v != null) as [string, string][],
  ).toString()
  redirect(qs ? `/mail?${qs}` : "/mail")
}
