const ELLIPSE_BG = "https://www.figma.com/api/mcp/asset/3cb24a63-de70-4de6-aee4-1b7f685c55ab";

const outcomes = [
  {
    title: "Never miss a follow-up",
    description:
      "Flowdesk remembers every next step and follows up at the right time, even when your inbox is full.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
      </svg>
    ),
  },
  {
    title: "Always-on availability",
    description:
      "Your inbox never sleeps. Flowdesk handles inbound messages around the clock so prospects always get a timely response.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    title: "Show up with context",
    description:
      "Every conversation includes history, contact info, and prior threads so you never walk in blind.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    title: "Keep deals moving",
    description:
      "Automated nudges and smart routing keep conversations from stalling while you focus on closing.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    title: "Book meetings instantly",
    description:
      "Coordinate availability and land meetings on your calendar without the back-and-forth.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    title: "Full audit trail",
    description:
      "Every automated action is logged. One-click override or disable at any time — you stay in control.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-10 px-5 sm:px-8">
      <div className="max-w-6xl mx-auto flex flex-col gap-4">
        {/* Section heading */}
        <div className="flex flex-col gap-1">
          <p className="text-sm text-black font-normal">{"// Outcomes"}</p>
          <h2 className="text-[40px] leading-[1] font-normal text-black">
            Less chasing. More meetings.
          </h2>
        </div>

        {/* Cards grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {outcomes.map((outcome, i) => (
            <div
              key={i}
              className="bg-[#f5f5f4] rounded-lg px-4 py-8 flex flex-col gap-8 items-start"
            >
              {/* Icon with circle bg */}
              <div className="relative shrink-0">
                <div className="relative w-16 h-16">
                  <img src={ELLIPSE_BG} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-contain" />
                  <div className="absolute inset-0 flex items-center justify-center text-black">
                    {outcome.icon}
                  </div>
                </div>
              </div>

              {/* Text */}
              <div className="flex flex-col gap-2 text-base">
                <p className="font-semibold text-black">{outcome.title}</p>
                <p className="font-normal text-[#6b6f76] leading-snug">
                  {outcome.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
