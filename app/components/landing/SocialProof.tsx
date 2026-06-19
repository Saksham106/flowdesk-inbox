import ScrollReveal from "@/app/components/ScrollReveal";

const stats = [
  {
    stat: "3×",
    label: "faster reply times",
    description: "Cut response times with AI-drafted messages and keyboard-first shortcuts.",
  },
  {
    stat: "100%",
    label: "audit trail",
    description: "Every send is logged. One-click override or disable at any time.",
  },
  {
    stat: "15 min",
    label: "to set up",
    description: "Connect your email and claim a phone number. No IT ticket required.",
  },
];

export default function SocialProof() {
  return (
    <section className="py-20 px-4 sm:px-6 bg-white border-b border-neutral-100">
      <div className="max-w-6xl mx-auto">
        <ScrollReveal>
          <p className="text-[11px] font-mono uppercase tracking-widest text-neutral-500 text-center mb-12">
            Built for teams that move fast
          </p>
        </ScrollReveal>

        <div className="grid sm:grid-cols-3 gap-10 sm:gap-8 sm:divide-x sm:divide-neutral-100">
          {stats.map((s, i) => (
            <ScrollReveal key={s.stat} delay={i * 100} className="sm:px-8 first:pl-0 last:pr-0">
              <div className="text-center sm:text-left">
                <div className="font-serif text-5xl sm:text-6xl text-neutral-900 mb-1 leading-none">
                  {s.stat}
                </div>
                <div className="text-sm font-semibold text-neutral-800 mb-2 mt-1">{s.label}</div>
                <div className="text-sm text-neutral-500 leading-relaxed">{s.description}</div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
