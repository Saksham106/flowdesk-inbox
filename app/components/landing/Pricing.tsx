import Link from "next/link";
import ScrollReveal from "@/app/components/ScrollReveal";

const plans = [
  {
    name: "Starter",
    tagline: "For small teams getting started.",
    features: [
      "1 shared inbox",
      "Up to 3 members",
      "Email + 1 phone number",
      "Copilot draft mode",
    ],
    highlighted: false,
  },
  {
    name: "Pro",
    tagline: "For growing teams that need more.",
    features: [
      "Unlimited inboxes & members",
      "Multiple phone numbers",
      "Copilot + Autopilot mode",
      "Audit logs & overrides",
    ],
    highlighted: true,
  },
];

function CheckIcon({ dark }: { dark: boolean }) {
  return (
    <div
      className={`shrink-0 mt-0.5 h-[18px] w-[18px] rounded-full flex items-center justify-center ${
        dark ? "bg-indigo-500/25" : "bg-indigo-50 border border-indigo-100"
      }`}
    >
      <svg
        width="9"
        height="9"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={dark ? "text-indigo-400" : "text-indigo-500"}
        aria-hidden="true"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </div>
  );
}

export default function Pricing() {
  return (
    <section id="pricing" className="py-20 px-4 sm:px-6 bg-white border-t border-neutral-100">
      <div className="max-w-6xl mx-auto">
        <ScrollReveal>
          <div className="text-center mb-12">
            <p className="text-[11px] font-mono uppercase tracking-widest text-neutral-400 mb-3">
              Pricing
            </p>
            <h2 className="font-serif text-3xl sm:text-4xl text-neutral-900 mb-2">
              Simple, flexible plans.
            </h2>
            <p className="text-sm text-neutral-400">
              Pricing finalised at launch — sign up to be first to know.
            </p>
          </div>
        </ScrollReveal>

        <div className="grid sm:grid-cols-2 gap-5 max-w-xl mx-auto">

          {/* Starter */}
          <ScrollReveal delay={100}>
            <div className="h-full rounded-2xl border border-neutral-200 bg-white p-8 flex flex-col gap-6 hover:shadow-md hover:shadow-neutral-900/5 transition-shadow">
              <div>
                <p className="text-xs font-mono font-semibold uppercase tracking-widest text-neutral-400 mb-2">
                  Starter
                </p>
                <p className="text-sm text-neutral-500 leading-relaxed">{plans[0].tagline}</p>
              </div>

              <ul className="flex-1 space-y-3">
                {plans[0].features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <CheckIcon dark={false} />
                    <span className="text-sm text-neutral-600">{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href="/login?signup=1"
                className="inline-flex items-center justify-center rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
              >
                Get started
              </Link>
            </div>
          </ScrollReveal>

          {/* Pro — gradient border + ambient glow */}
          <ScrollReveal delay={200}>
            <div className="relative h-full">
              {/* Ambient glow behind card */}
              <div
                className="absolute -inset-3 rounded-3xl pointer-events-none"
                style={{
                  background:
                    "radial-gradient(ellipse at 50% 50%, rgba(99,102,241,0.18) 0%, transparent 70%)",
                }}
              />

              {/* Gradient border wrapper */}
              <div
                className="relative h-full rounded-2xl p-[1.5px] shadow-xl shadow-indigo-500/25"
                style={{
                  background:
                    "linear-gradient(160deg, #6366f1 0%, #8b5cf6 50%, #7c3aed 100%)",
                }}
              >
                {/* Most popular badge — centered, floating above card top edge */}
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-10">
                  <span
                    className="inline-block rounded-full px-3 py-1 text-[11px] font-semibold text-white whitespace-nowrap"
                    style={{ background: "linear-gradient(135deg, #6366f1 0%, #7c3aed 100%)" }}
                  >
                    Most popular
                  </span>
                </div>

                <div className="h-full rounded-[calc(1rem-1px)] bg-[#0d0d14] p-8 flex flex-col gap-6">
                  {/* Header */}
                  <div>
                    <p className="text-xs font-mono font-semibold uppercase tracking-widest text-indigo-400 mb-2">
                      Pro
                    </p>
                    <p className="text-sm text-white/50 leading-relaxed">{plans[1].tagline}</p>
                  </div>

                  <ul className="flex-1 space-y-3">
                    {plans[1].features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5">
                        <CheckIcon dark />
                        <span className="text-sm text-white/75">{f}</span>
                      </li>
                    ))}
                  </ul>

                  <Link
                    href="/login?signup=1"
                    className="inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
                    style={{
                      background: "linear-gradient(135deg, #6366f1 0%, #7c3aed 100%)",
                    }}
                  >
                    Get started with Pro
                  </Link>
                </div>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}
