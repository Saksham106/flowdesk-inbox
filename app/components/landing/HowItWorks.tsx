import ScrollReveal from "@/app/components/ScrollReveal";

const steps = [
  {
    number: "01",
    title: "Connect",
    description:
      "Link your email accounts and claim a dedicated phone number in minutes. No IT ticket, no engineering required.",
  },
  {
    number: "02",
    title: "Triage",
    description:
      "Incoming messages are automatically labeled and routed. Urgent threads surface to the top so nothing urgent gets buried.",
  },
  {
    number: "03",
    title: "Reply",
    description:
      "Review Copilot-drafted replies, make edits if needed, and send — or let Autopilot handle the routine ones while you focus on the rest.",
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-20 px-4 sm:px-6 bg-neutral-50 border-t border-neutral-100">
      <div className="max-w-6xl mx-auto">
        <ScrollReveal>
          <div className="text-center mb-16">
            <p className="text-[11px] font-mono uppercase tracking-widest text-neutral-400 mb-3">
              How it works
            </p>
            <h2 className="font-serif text-3xl sm:text-4xl text-neutral-900">
              Up and running in minutes.
            </h2>
          </div>
        </ScrollReveal>

        <div className="grid sm:grid-cols-3 gap-8 lg:gap-12">
          {steps.map((step, i) => (
            <ScrollReveal key={step.number} delay={i * 130}>
              <div className="relative">
                {/* Large background number */}
                <div
                  className="font-mono font-bold text-[96px] sm:text-[112px] leading-none select-none mb-1 -ml-1"
                  style={{ color: "rgba(0,0,0,0.03)" }}
                  aria-hidden="true"
                >
                  {step.number}
                </div>
                <div className="-mt-10 sm:-mt-12">
                  <h3 className="text-lg font-semibold text-neutral-900 mb-2">{step.title}</h3>
                  <p className="text-sm text-neutral-500 leading-relaxed">{step.description}</p>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
