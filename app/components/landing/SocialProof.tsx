const bullets = [
  {
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
    label: "Faster replies",
    description: "Cut response times with smart drafts and keyboard-first shortcuts.",
  },
  {
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    label: "Clear ownership",
    description: "Assign conversations to teammates so nothing slips through the cracks.",
  },
  {
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="8" y1="6" x2="21" y2="6" />
        <line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" />
        <line x1="3" y1="18" x2="3.01" y2="18" />
      </svg>
    ),
    label: "Less busywork",
    description: "Labels, reminders, and routing handle the sorting so you don't have to.",
  },
];

export default function SocialProof() {
  return (
    <section className="py-14 border-y border-neutral-100 bg-neutral-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <p className="text-sm font-medium uppercase tracking-widest text-neutral-400 text-center mb-6">
          Built for teams that move fast.
        </p>

        {/* Mobile: icon cards */}
        <div className="sm:hidden space-y-3">
          {bullets.map((b) => (
            <div
              key={b.label}
              className="flex items-start gap-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm shadow-neutral-900/[0.03]"
            >
              <div className="shrink-0 mt-0.5 inline-flex items-center justify-center h-8 w-8 rounded-lg border border-neutral-200 bg-neutral-50 text-neutral-600">
                {b.icon}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-neutral-900 mb-1">{b.label}</p>
                <p className="text-sm text-neutral-500 leading-relaxed">{b.description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop: 3-column grid */}
        <div className="hidden sm:grid sm:grid-cols-3 gap-8">
          {bullets.map((b) => (
            <div key={b.label} className="text-center">
              <p className="text-base font-semibold text-neutral-900 mb-1">{b.label}</p>
              <p className="text-sm text-neutral-500 leading-relaxed">{b.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
