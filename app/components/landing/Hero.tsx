import Link from "next/link";

export default function Hero() {
  return (
    <section className="pt-20 pb-16 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <span className="inline-block mb-5 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-medium text-neutral-500 tracking-wide uppercase">
            Now in early access
          </span>

          <h1 className="font-serif text-5xl sm:text-6xl text-neutral-900 leading-[1.1] mb-5">
            One inbox for every conversation.
          </h1>

          <p className="text-base sm:text-lg text-neutral-500 leading-relaxed mb-8 max-w-md mx-auto">
            Email and texts, unified. Draft replies faster, never miss a follow-up.
          </p>

          <div className="flex flex-wrap gap-3 justify-center">
            <Link
              href="/login?signup=1"
              className="inline-flex items-center rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 transition-colors"
            >
              Get started free
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex items-center rounded-lg border border-neutral-200 bg-white px-5 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
            >
              See how it works
            </a>
          </div>
        </div>

        {/* Product mock */}
        <div className="rounded-2xl border border-neutral-200 shadow-lg shadow-neutral-900/5 overflow-hidden bg-white">
          <div className="flex h-[320px] sm:h-[380px]">
            {/* Sidebar / inbox list */}
            <div className="w-64 shrink-0 border-r border-neutral-100 flex flex-col">
              <div className="p-4 border-b border-neutral-100">
                <div className="h-5 w-24 rounded bg-neutral-100 animate-pulse" />
              </div>
              <div className="overflow-y-auto flex-1 divide-y divide-neutral-50">
                {[
                  { active: true, unread: true, nameW: "w-20", previewW: "w-32" },
                  { active: false, unread: true, nameW: "w-24", previewW: "w-28" },
                  { active: false, unread: false, nameW: "w-16", previewW: "w-36" },
                  { active: false, unread: false, nameW: "w-28", previewW: "w-24" },
                  { active: false, unread: false, nameW: "w-20", previewW: "w-30" },
                  { active: false, unread: false, nameW: "w-18", previewW: "w-32" },
                ].map((row, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-3 px-4 py-3 ${row.active ? "bg-neutral-50" : "hover:bg-neutral-50"} transition-colors cursor-pointer`}
                  >
                    <div className="mt-0.5 shrink-0 h-8 w-8 rounded-full bg-neutral-200" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className={`h-3 rounded ${row.nameW} ${row.unread ? "bg-neutral-800" : "bg-neutral-200"}`} />
                        <div className="h-2.5 w-8 rounded bg-neutral-100 ml-2 shrink-0" />
                      </div>
                      <div className={`h-2.5 rounded ${row.previewW} bg-neutral-100`} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Message pane */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="h-14 border-b border-neutral-100 px-6 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-neutral-200 shrink-0" />
                  <div>
                    <div className="h-3.5 w-24 rounded bg-neutral-800 mb-1.5" />
                    <div className="h-2.5 w-32 rounded bg-neutral-100" />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-7 w-20 rounded-md bg-neutral-100" />
                  <div className="h-7 w-16 rounded-md bg-neutral-900/10" />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="flex justify-start">
                  <div className="max-w-xs rounded-2xl rounded-tl-sm bg-neutral-100 px-4 py-3 space-y-2">
                    <div className="h-2.5 w-48 rounded bg-neutral-300" />
                    <div className="h-2.5 w-36 rounded bg-neutral-300" />
                    <div className="h-2.5 w-40 rounded bg-neutral-300" />
                  </div>
                </div>
                <div className="flex justify-end">
                  <div className="max-w-xs rounded-2xl rounded-tr-sm bg-neutral-900 px-4 py-3 space-y-2">
                    <div className="h-2.5 w-44 rounded bg-neutral-600" />
                    <div className="h-2.5 w-32 rounded bg-neutral-600" />
                  </div>
                </div>
                <div className="flex justify-start">
                  <div className="max-w-xs rounded-2xl rounded-tl-sm bg-neutral-100 px-4 py-3 space-y-2">
                    <div className="h-2.5 w-40 rounded bg-neutral-300" />
                    <div className="h-2.5 w-52 rounded bg-neutral-300" />
                  </div>
                </div>
                <div className="flex justify-end">
                  <div className="max-w-sm rounded-2xl rounded-tr-sm border border-neutral-200 bg-white px-4 py-3 space-y-2 shadow-sm">
                    <div className="flex items-center gap-1.5 mb-2">
                      <div className="h-2 w-2 rounded-full bg-violet-400" />
                      <div className="h-2.5 w-16 rounded bg-neutral-200 text-xs" />
                    </div>
                    <div className="h-2.5 w-48 rounded bg-neutral-200" />
                    <div className="h-2.5 w-36 rounded bg-neutral-200" />
                    <div className="flex gap-2 mt-3">
                      <div className="h-6 w-14 rounded bg-neutral-900" />
                      <div className="h-6 w-14 rounded bg-neutral-100" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 border-t border-neutral-100 shrink-0">
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 flex items-center justify-between gap-4">
                  <div className="h-3 w-48 rounded bg-neutral-200" />
                  <div className="h-7 w-16 rounded-lg bg-neutral-900 shrink-0" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
