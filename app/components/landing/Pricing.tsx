import Link from "next/link";
import ScrollReveal from "@/app/components/ScrollReveal";

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0" aria-hidden="true">
      <circle cx="8" cy="8" r="8" fill="#1a1a1a" />
      <polyline points="4.5,8.5 7,11 11.5,5.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
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
    <section id="pricing" className="py-[160px] px-5 sm:px-8">
      <div className="max-w-6xl mx-auto flex flex-col gap-10">
        {/* Section heading */}
        <ScrollReveal>
          <div className="flex flex-col gap-2">
            <p className="text-sm text-black font-normal">{"// Pricing"}</p>
            <h2 className="text-[36px] leading-[1] font-normal text-black">
              Start with conversations you already have
            </h2>
          </div>
        </ScrollReveal>

        {/* Pricing cards */}
        <div className="flex flex-col lg:flex-row gap-6">
          {plans.map((plan, i) => (
            <ScrollReveal key={plan.name} delay={i * 100} className="flex-1 min-w-0">
            <div
              className="bg-[#f5f5f4] rounded-lg p-8 flex flex-col gap-2 h-full"
            >
              {/* Plan info */}
              <div className="flex flex-col gap-1">
                <p className="text-lg font-medium text-black">{plan.name}</p>
                <p className="text-[32px] font-medium text-black leading-none">
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
                className="text-lg font-medium text-black hover:opacity-70 transition-opacity"
              >
                {plan.cta}
              </Link>

              {/* Divider with label */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-black/10" />
                <p className="text-sm text-[#6b6f76]">Features</p>
                <div className="flex-1 h-px bg-black/10" />
              </div>

              {/* Feature list */}
              <ul className="flex flex-col gap-2">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <CheckIcon />
                    <span className="text-sm text-black">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
