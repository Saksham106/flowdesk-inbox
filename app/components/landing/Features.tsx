import ScrollReveal from "@/app/components/ScrollReveal";

const InboxIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
);

const DraftIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);

const TagIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);

const AutopilotIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
  </svg>
);

export default function Features() {
  return (
    <section id="features" className="py-20 px-4 sm:px-6 bg-neutral-50 border-t border-neutral-100">
      <div className="max-w-6xl mx-auto">
        <ScrollReveal>
          <div className="text-center mb-12">
            <p className="text-[11px] font-mono uppercase tracking-widest text-neutral-400 mb-3">
              Features
            </p>
            <h2 className="font-serif text-3xl sm:text-4xl text-neutral-900">
              Everything you need, nothing you don&apos;t.
            </h2>
          </div>
        </ScrollReveal>

        {/* Bento grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

          {/* Wide card — Unified inbox */}
          <ScrollReveal delay={80} className="sm:col-span-2">
            <div className="h-full rounded-2xl border border-neutral-200 bg-white p-6 hover:shadow-md hover:shadow-neutral-900/5 transition-shadow overflow-hidden relative">
              {/* Mini inbox illustration */}
              <div className="mb-5 rounded-xl border border-neutral-100 bg-neutral-50 overflow-hidden h-28">
                <div className="flex h-full">
                  <div className="w-32 border-r border-neutral-100 flex flex-col divide-y divide-neutral-50">
                    {[
                      { initials: "SC", color: "bg-indigo-400", name: "Sarah C.", tag: "Lead", tagColor: "text-indigo-500" },
                      { initials: "MJ", color: "bg-violet-400", name: "Mike J.", tag: "Support", tagColor: "text-violet-500" },
                      { initials: "ED", color: "bg-emerald-400", name: "Emma D.", tag: "Lead", tagColor: "text-indigo-500" },
                    ].map((r) => (
                      <div key={r.initials} className="flex items-center gap-2 px-2.5 py-2">
                        <div className={`h-5 w-5 rounded-full ${r.color} flex items-center justify-center text-[8px] font-bold text-white shrink-0`}>
                          {r.initials}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[9px] font-semibold text-neutral-700 truncate">{r.name}</p>
                          <p className={`text-[8px] font-medium ${r.tagColor}`}>{r.tag}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex-1 p-2.5 flex flex-col gap-1.5">
                    <div className="self-start rounded-xl bg-neutral-200 px-2.5 py-1.5 max-w-[80%]">
                      <div className="h-1.5 w-24 bg-neutral-400 rounded" />
                    </div>
                    <div className="self-end rounded-xl px-2.5 py-1.5 max-w-[70%]" style={{ background: "linear-gradient(135deg,#6366f1,#7c3aed)" }}>
                      <div className="h-1.5 w-20 bg-white/50 rounded" />
                    </div>
                    <div className="self-start rounded-xl bg-neutral-200 px-2.5 py-1.5 max-w-[60%]">
                      <div className="h-1.5 w-16 bg-neutral-400 rounded" />
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2.5 mb-2">
                <div className="shrink-0 h-8 w-8 rounded-lg border border-neutral-200 bg-neutral-50 flex items-center justify-center text-neutral-600">
                  <InboxIcon />
                </div>
                <h3 className="text-base font-semibold text-neutral-900">Unified inbox</h3>
              </div>
              <p className="text-sm text-neutral-500 leading-relaxed">
                Email and text threads side by side in a single view. No more switching tabs or apps to keep up with every conversation.
              </p>
            </div>
          </ScrollReveal>

          {/* Tall card — AI Draft (dark/colored) */}
          <ScrollReveal delay={160}>
            <div
              className="h-full rounded-2xl p-6 flex flex-col text-white relative overflow-hidden"
              style={{ background: "linear-gradient(160deg, #4f46e5 0%, #7c3aed 60%, #6d28d9 100%)" }}
            >
              {/* decorative glow */}
              <div
                className="absolute -top-8 -right-8 h-32 w-32 rounded-full pointer-events-none"
                style={{ background: "rgba(255,255,255,0.08)" }}
              />
              {/* Mini AI suggestion card */}
              <div className="mb-5 rounded-xl bg-white/10 border border-white/20 p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" className="text-white/80" aria-hidden="true">
                    <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
                  </svg>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-white/70">AI Draft</span>
                </div>
                <div className="space-y-1.5">
                  <div className="h-1.5 rounded bg-white/30 w-full" />
                  <div className="h-1.5 rounded bg-white/20 w-5/6" />
                  <div className="h-1.5 rounded bg-white/20 w-4/5" />
                </div>
                <div className="flex gap-1.5 mt-3">
                  <div className="flex-1 rounded-md bg-white/20 py-1.5 text-center text-[9px] font-semibold text-white">Send</div>
                  <div className="flex-1 rounded-md border border-white/20 py-1.5 text-center text-[9px] font-medium text-white/60">Edit</div>
                </div>
              </div>
              <div className="flex items-center gap-2.5 mb-2">
                <div className="shrink-0 h-8 w-8 rounded-lg bg-white/15 flex items-center justify-center">
                  <DraftIcon />
                </div>
                <h3 className="text-base font-semibold">Draft replies with approval</h3>
              </div>
              <p className="text-sm text-white/70 leading-relaxed">
                Copilot composes context-aware replies for your review. Edit, approve, or discard — you always send the final word.
              </p>
            </div>
          </ScrollReveal>

          {/* Labels & routing */}
          <ScrollReveal delay={240}>
            <div className="h-full rounded-2xl border border-neutral-200 bg-white p-6 hover:shadow-md hover:shadow-neutral-900/5 transition-shadow">
              {/* Mini label pills */}
              <div className="mb-5 flex flex-wrap gap-1.5">
                {[
                  { label: "Lead", color: "bg-indigo-50 text-indigo-600 border-indigo-100" },
                  { label: "Urgent", color: "bg-red-50 text-red-600 border-red-100" },
                  { label: "Follow-up", color: "bg-amber-50 text-amber-600 border-amber-100" },
                ].map((t) => (
                  <span key={t.label} className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${t.color}`}>
                    {t.label}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-2.5 mb-2">
                <div className="shrink-0 h-8 w-8 rounded-lg border border-neutral-200 bg-neutral-50 flex items-center justify-center text-neutral-600">
                  <TagIcon />
                </div>
                <h3 className="text-base font-semibold text-neutral-900">Labels, routing & reminders</h3>
              </div>
              <p className="text-sm text-neutral-500 leading-relaxed">
                Tag threads automatically, route to the right person, and set follow-up reminders so nothing goes cold.
              </p>
            </div>
          </ScrollReveal>

          {/* Autopilot — wide */}
          <ScrollReveal delay={320} className="sm:col-span-2">
            <div className="h-full rounded-2xl border border-neutral-200 bg-white p-6 relative overflow-hidden hover:shadow-md hover:shadow-neutral-900/5 transition-shadow">
              {/* Mini autopilot illustration */}
              <div className="mb-5 rounded-xl border border-neutral-100 bg-neutral-50 overflow-hidden">
                <div className="px-3 py-2.5 space-y-2">
                  {[
                    { subject: "New inquiry — Sarah C.", status: "Auto-replied", statusCls: "bg-emerald-50 text-emerald-600 border-emerald-100" },
                    { subject: "Pricing question — Mike J.", status: "Auto-replied", statusCls: "bg-emerald-50 text-emerald-600 border-emerald-100" },
                    { subject: "Enterprise request", status: "Needs review", statusCls: "bg-amber-50 text-amber-600 border-amber-100" },
                  ].map((row) => (
                    <div key={row.subject} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-1.5 w-1.5 rounded-full bg-neutral-300 shrink-0" />
                        <span className="text-[10px] text-neutral-500 truncate">{row.subject}</span>
                      </div>
                      <span className={`shrink-0 text-[9px] font-semibold border px-2 py-0.5 rounded-full ${row.statusCls}`}>{row.status}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2.5 mb-2">
                <div className="shrink-0 h-8 w-8 rounded-lg border border-neutral-200 bg-neutral-50 flex items-center justify-center text-neutral-600">
                  <AutopilotIcon />
                </div>
                <h3 className="text-base font-semibold text-neutral-900">Autopilot mode</h3>
              </div>
              <p className="text-sm text-neutral-500 leading-relaxed max-w-md">
                For routine, repeatable categories, FlowDesk sends human-sounding replies based on your rules — with full audit logs and one-click overrides. You decide what gets automated.
              </p>
            </div>
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}
