import ScrollReveal from "@/app/components/ScrollReveal";

const ELLIPSE_BG = "/images/landing/outcome-icon-bg.svg";

const outcomes = [
  {
    title: "Nothing slips through",
    description:
      "FlowDesk remembers every thread you're waiting on and nudges it at the right time, even when your week gets away from you.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    title: "You approve every send",
    description:
      "FlowDesk drafts; you decide. Nothing leaves your inbox without your say-so, and every action is logged and undoable.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" />
      </svg>
    ),
  },
  {
    title: "It sounds like you",
    description:
      "Drafts are written in your voice, learned from your own sent mail — not a canned template your friends would see through.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 px-5 sm:px-8">
      <div className="max-w-6xl mx-auto flex flex-col gap-10">
        <ScrollReveal>
          <div className="flex flex-col gap-2">
            <p className="text-xs uppercase tracking-[0.14em] text-[#6b6f76] font-medium">Why it feels different</p>
            <h2
              className="text-[36px] leading-[1.15] font-normal text-black"
              style={{ fontFamily: "var(--font-lora), Georgia, serif" }}
            >
              Less time in email. Less email on your mind.
            </h2>
          </div>
        </ScrollReveal>

        <div className="flex flex-col lg:flex-row gap-6">
          {outcomes.map((outcome, i) => (
            <ScrollReveal key={i} delay={i * 100} className="flex-1">
              <div className="landing-card bg-[#f5f5f4] rounded-lg px-6 py-10 flex flex-col gap-8 items-start h-full">
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
