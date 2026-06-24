import Link from "next/link";

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-black" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

const plans = [
  {
    name: "Free",
    price: "$0",
    period: "/month",
    description: "Perfect for trying Flowdesk. All core features included, forever.",
    cta: "Get Started",
    ctaHref: "/login?signup=1",
    features: [
      "1 shared inbox",
      "Up to 3 members",
      "Email integration",
      "Copilot draft mode",
      "Basic follow-up rules",
      "7-day message history",
      "Community support",
    ],
  },
  {
    name: "Pro",
    price: "$20",
    period: "/month",
    description: "For growing teams that need more power and automation.",
    cta: "Get Started",
    ctaHref: "/login?signup=1",
    features: [
      "Unlimited inboxes & members",
      "Multiple phone numbers",
      "Copilot + Autopilot mode",
      "Advanced follow-up sequences",
      "Audit logs & overrides",
      "Unlimited message history",
      "Priority support",
    ],
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    description: "For teams that need dedicated support, custom deployment, and advanced security.",
    cta: "Contact sales",
    ctaHref: "mailto:admin@flowdeskinbox.com",
    features: [
      "Everything in Pro",
      "Custom integrations",
      "SSO & advanced permissions",
      "Dedicated account manager",
      "SLA guarantees",
      "Custom deployment",
      "Security review",
    ],
  },
];

export default function Pricing() {
  return (
    <section id="pricing" className="py-10 px-5 sm:px-8">
      <div className="max-w-6xl mx-auto flex flex-col gap-4">
        {/* Section heading */}
        <div className="flex flex-col gap-1">
          <p className="text-sm text-black font-normal">{"// Pricing"}</p>
          <h2 className="text-[40px] leading-[1] font-normal text-black">
            Start with conversations you already have
          </h2>
        </div>

        {/* Pricing cards */}
        <div className="flex flex-col lg:flex-row gap-4">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className="flex-1 min-w-0 bg-[#f5f5f4] rounded-lg p-8 flex flex-col gap-2"
            >
              {/* Plan info */}
              <div className="flex flex-col gap-1 mb-2">
                <p className="text-lg font-semibold text-black">{plan.name}</p>
                <p className="text-[32px] font-semibold text-black leading-none">
                  {plan.price}
                  {plan.period && (
                    <span className="text-base font-normal text-black">{plan.period}</span>
                  )}
                </p>
                <p className="text-sm text-black">{plan.description}</p>
              </div>

              {/* CTA */}
              <Link
                href={plan.ctaHref}
                className="inline-flex items-center justify-center w-full rounded-lg bg-black text-white text-sm font-medium py-2.5 hover:opacity-85 transition-opacity mb-2"
              >
                {plan.cta}
              </Link>

              {/* Divider with label */}
              <div className="flex items-center gap-3 my-2">
                <div className="flex-1 h-px bg-black/10" />
                <p className="text-xs font-medium text-[#6b6f76]">Features</p>
                <div className="flex-1 h-px bg-black/10" />
              </div>

              {/* Feature list */}
              <ul className="flex flex-col gap-2">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <CheckIcon />
                    <span className="text-xs text-black">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
