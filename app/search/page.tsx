import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { redirect } from "next/navigation"
import { searchMessages } from "@/lib/agent/search"
import Link from "next/link"

export default async function SearchPage({
  searchParams,
}: {
  searchParams: { q?: string }
}) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")

  const q = searchParams.q?.trim() ?? ""
  const results = q ? await searchMessages(session.user.tenantId, q, 20) : []

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <div className="mx-auto w-full max-w-2xl px-4 py-8">
        <h1 className="mb-6 text-xl font-semibold text-slate-900">Search</h1>

        <form method="GET" action="/search" className="mb-6">
          <div className="flex gap-2">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search messages…"
              autoFocus
              className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm shadow-sm focus:border-slate-400 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Search
            </button>
          </div>
        </form>

        {q && (
          <p className="mb-4 text-xs text-slate-500">
            {results.length} result{results.length !== 1 ? "s" : ""} for &ldquo;{q}&rdquo;
          </p>
        )}

        <div className="space-y-3">
          {results.map((r) => (
            <Link
              key={r.id}
              href={`/conversations/${r.conversationId}`}
              className="block rounded-lg border border-slate-200 bg-white px-4 py-3 hover:border-slate-300 hover:shadow-sm"
            >
              <p className="mb-1 text-xs text-slate-400">
                {r.direction === "inbound" ? "Received" : "Sent"} &middot;{" "}
                {new Date(r.createdAt).toLocaleDateString()}
              </p>
              <p className="line-clamp-3 text-sm text-slate-700">{r.body}</p>
            </Link>
          ))}
          {results.length === 0 && q && (
            <p className="text-center text-sm text-slate-400">No messages found.</p>
          )}
        </div>
      </div>
    </div>
  )
}
