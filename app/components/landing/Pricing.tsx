import Link from "next/link";

const plans = [
  {
    name: "Starter",
    tagline: "Small teams.",
    features: [
      "1 shared inbox",
      "Up to 3 members",
      "Email + 1 number",
      "Copilot draft mode",
    ],
    highlighted: false,
  },
  {
    name: "Pro",
    tagline: "Growing teams.",
    features: [
      "Unlimited inboxes & members",
      "Multiple phone numbers",
      "Copilot + Autopilot mode",
      "Audit logs & overrides",
    ],
    highlighted: true,
  },
];

export default function Pricing() {
  return (
    <section id="pricing" className="py-16 px-6 border-t border-neutral-100">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-10">
          <h2 className="font-serif text-3xl sm:text-4xl text-neutral-900 mb-2">
            Simple, flexible plans.
          </h2>
          <p className="text-sm text-neutral-400">Pricing finalised at launch — sign up to be first to know.</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-5 max-w-xl mx-auto">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-2xl border p-8 flex flex-col gap-6 ${
                plan.highlighted
                  ? "border-neutral-900 bg-neutral-900 text-white shadow-xl shadow-neutral-900/20"
                  : "border-neutral-200 bg-white"
              }`}
            >
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-2 text-neutral-400">
                  {plan.name}
                </p>
                <p className={`text-sm leading-relaxed ${plan.highlighted ? "text-neutral-300" : "text-neutral-500"}`}>
                  {plan.tagline}
                </p>
              </div>

              <ul className="flex-1 space-y-3">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="mt-0.5 shrink-0 text-neutral-400"
                      aria-hidden="true"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span className={`text-sm ${plan.highlighted ? "text-neutral-200" : "text-neutral-600"}`}>{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href="/login?signup=1"
                className={`inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                  plan.highlighted
                    ? "bg-white text-neutral-900 hover:bg-neutral-100"
                    : "bg-neutral-900 text-white hover:bg-neutral-700"
                }`}
              >
                Get started
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
