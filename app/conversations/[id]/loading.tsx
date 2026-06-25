export default function ConversationLoading() {
  return (
    <>
      {/* Desktop (lg+) — mirrors AppRail + DesktopResizablePanels layout */}
      <div className="hidden lg:flex h-screen overflow-hidden bg-slate-50">
        {/* AppRail placeholder */}
        <div className="flex h-full w-14 shrink-0 flex-col items-center bg-slate-900 py-3 gap-3">
          <div className="h-8 w-8 rounded-lg bg-slate-700 animate-pulse" />
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-9 w-10 rounded-lg bg-slate-800 animate-pulse" />
          ))}
        </div>

        <div className="flex flex-1 min-w-0 overflow-hidden">
          {/* Inbox list column (280px default) */}
          <div className="h-full w-[280px] shrink-0 border-r border-slate-200 bg-white overflow-hidden">
            <div className="border-b border-slate-200 px-3 py-2 animate-pulse">
              <div className="h-7 bg-slate-100 rounded-md" />
            </div>
            {[...Array(9)].map((_, i) => (
              <div key={i} className="border-b border-slate-50 px-3 py-2.5 animate-pulse">
                <div className="flex justify-between mb-1.5">
                  <div className="h-2.5 bg-slate-200 rounded w-2/5" />
                  <div className="h-2 bg-slate-100 rounded w-10" />
                </div>
                <div className="h-2 bg-slate-100 rounded w-3/4 mb-1.5" />
                <div className="h-1.5 bg-slate-100 rounded w-16" />
              </div>
            ))}
          </div>

          {/* Main thread panel */}
          <div className="flex flex-1 min-w-0 flex-col border-r border-slate-200 bg-white overflow-hidden">
            {/* Thread header */}
            <div className="shrink-0 border-b border-slate-200 px-5 py-3 animate-pulse">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-3 bg-slate-200 rounded w-36" />
                  <div className="h-5 bg-slate-100 rounded-full w-16" />
                </div>
                <div className="flex gap-2">
                  <div className="h-7 bg-slate-100 rounded-lg w-20" />
                  <div className="h-7 bg-slate-100 rounded-lg w-20" />
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-hidden px-2 py-3 space-y-4">
              {[
                { outbound: false, lines: 4 },
                { outbound: true, lines: 2 },
              ].map((msg, i) => (
                <div
                  key={i}
                  className={`rounded-xl border px-3 py-2.5 animate-pulse ${
                    msg.outbound ? "border-blue-100 bg-blue-50" : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex items-start gap-2 mb-3">
                    <div className="h-7 w-7 shrink-0 rounded-full bg-slate-200" />
                    <div className="flex-1">
                      <div className="h-2.5 bg-slate-200 rounded w-1/3 mb-1.5" />
                      <div className="h-2 bg-slate-100 rounded w-1/4" />
                    </div>
                    <div className="h-2 bg-slate-100 rounded w-20" />
                  </div>
                  <div className="space-y-2">
                    {[...Array(msg.lines)].map((_, j) => (
                      <div
                        key={j}
                        className="h-2.5 bg-slate-100 rounded"
                        style={{ width: j === msg.lines - 1 ? "60%" : "100%" }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Reply box */}
            <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-4 animate-pulse">
              <div className="h-20 bg-slate-100 rounded-lg" />
            </div>
          </div>

          {/* Right sidebar (300px default) */}
          <div className="h-full w-[300px] shrink-0 overflow-hidden p-3 space-y-2.5">
            {[
              { titleW: "w-16", lines: 2 },
              { titleW: "w-20", lines: 3 },
              { titleW: "w-12", lines: 2 },
            ].map((card, i) => (
              <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 animate-pulse">
                <div className={`h-2 bg-slate-200 rounded ${card.titleW} mb-3`} />
                <div className="space-y-2">
                  {[...Array(card.lines)].map((_, j) => (
                    <div
                      key={j}
                      className="h-2.5 bg-slate-100 rounded"
                      style={{ width: j === card.lines - 1 ? "70%" : "100%" }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile (< lg) */}
      <div className="lg:hidden min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white px-4 py-4 animate-pulse">
          <div className="h-2.5 bg-slate-200 rounded w-24 mb-3" />
          <div className="h-5 bg-slate-200 rounded w-1/2 mb-1.5" />
          <div className="h-3 bg-slate-100 rounded w-1/3" />
        </header>
        <div className="px-4 py-6 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden animate-pulse">
            <div className="border-b border-slate-100 px-4 py-4">
              <div className="h-2 bg-slate-200 rounded w-24 mb-2" />
              <div className="h-4 bg-slate-200 rounded w-1/2" />
            </div>
            {[...Array(2)].map((_, i) => (
              <div key={i} className="px-4 py-4 border-t border-slate-100 space-y-2">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-9 w-9 rounded-full bg-slate-200 shrink-0" />
                  <div className="flex-1">
                    <div className="h-2.5 bg-slate-200 rounded w-1/3 mb-1.5" />
                    <div className="h-2 bg-slate-100 rounded w-1/4" />
                  </div>
                </div>
                {[...Array(3)].map((_, j) => (
                  <div key={j} className="h-2.5 bg-slate-100 rounded" style={{ width: j === 2 ? "60%" : "100%" }} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
