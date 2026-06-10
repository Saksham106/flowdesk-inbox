const features = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
    ),
    title: "Unified inbox",
    description:
      "Email and text threads side by side in a single view. No more switching tabs or apps to keep up.",
    badge: null,
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    ),
    title: "Draft replies with approval",
    description:
      "Copilot mode composes context-aware replies for your review. Edit, approve, or discard — you always send the final word.",
    badge: null,
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
        <line x1="7" y1="7" x2="7.01" y2="7" />
      </svg>
    ),
    title: "Labels, routing, and reminders",
    description:
      "Tag threads automatically, route them to the right person, and set follow-up reminders so nothing goes cold.",
    badge: null,
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    title: "Autopilot mode",
    description:
      "For routine, repeatable categories, FlowDesk can send human-sounding replies based on your rules — with full audit logs and one-click overrides. You decide what's automated.",
    badge: "Coming soon",
  },
];

export default function Features() {
  return (
    <section id="features" className="py-16 px-6 border-t border-neutral-100">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-10">
          <h2 className="font-serif text-3xl sm:text-4xl text-neutral-900">
            Everything you need, nothing you don't.
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 gap-5">
          {features.map((f) => (
            <div
              key={f.title}
              className="relative rounded-2xl border border-neutral-200 bg-white p-6 hover:shadow-md hover:shadow-neutral-900/5 transition-shadow"
            >
              {f.badge && (
                <span className="absolute top-5 right-5 rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-0.5 text-xs font-medium text-neutral-400">
                  {f.badge}
                </span>
              )}
              <div className="mb-4 inline-flex items-center justify-center h-9 w-9 rounded-lg border border-neutral-200 bg-neutral-50 text-neutral-700">
                {f.icon}
              </div>
              <h3 className="text-base font-semibold text-neutral-900 mb-2">{f.title}</h3>
              <p className="text-sm text-neutral-500 leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
