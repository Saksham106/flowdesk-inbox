import ScrollReveal from "@/app/components/ScrollReveal";

const ELLIPSE_BG = "/images/landing/outcome-icon-bg.svg";

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
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-[160px] px-5 sm:px-8">
      <div className="max-w-6xl mx-auto flex flex-col gap-10">
        <ScrollReveal>
          <div className="flex flex-col gap-2">
            <p className="text-sm text-black font-normal">{"// Outcomes"}</p>
            <h2 className="text-[36px] leading-[1] font-normal text-black">
              Less chasing. More meetings.
            </h2>
          </div>
        </ScrollReveal>

        <div className="flex flex-col lg:flex-row gap-6">
          {outcomes.map((outcome, i) => (
            <ScrollReveal key={i} delay={i * 100} className="flex-1">
              <div className="bg-[#f5f5f4] rounded-lg px-6 py-10 flex flex-col gap-8 items-start h-full">
                <div className="relative shrink-0 size-16 flex items-center justify-center">
                  <img src={ELLIPSE_BG} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-contain" />
                  <div className="relative text-black">{outcome.icon}</div>
                </div>

                <div className="flex flex-col gap-2 text-base">
                  <p className="font-medium text-black">{outcome.title}</p>
                  <p className="font-normal text-[#6b6f76] leading-snug">
                    {outcome.description}
                  </p>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
