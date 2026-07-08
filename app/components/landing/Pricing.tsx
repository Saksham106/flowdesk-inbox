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

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0" aria-hidden="true">
      <circle cx="8" cy="8" r="7.25" stroke="#a3a3a0" strokeWidth="1.5" />
      <path d="M8 4.5V8l2.5 1.5" stroke="#a3a3a0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const includedFeatures = [
  "Connect your Gmail account",
  "Automatic email classification & Gmail labels",
  "AI reply drafts, written into Gmail for your review",
  "Approvals, full audit log & undo",
  "Adjustable automation level — you set how much it does alone",
  "Waiting-on & follow-up tracking",
  "Bulk inbox cleanup with one-hour undo",
];

const plannedFeatures = [
  "Team & shared inboxes",
  "Paid plans with usage tiers",
  "SSO & advanced permissions",
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
              Free during beta
            </h2>
          </div>
        </ScrollReveal>

        {/* Single beta plan card */}
        <ScrollReveal className="max-w-xl">
          <div className="bg-[#f5f5f4] rounded-lg p-8 flex flex-col gap-2">
            {/* Plan info */}
            <div className="flex flex-col gap-1">
              <p className="text-lg font-medium text-black">Beta</p>
              <p className="text-[32px] font-medium text-black leading-none">
                $0
                <span className="text-base font-normal text-black">/month</span>
              </p>
              <p className="text-sm text-black">
                FlowDesk is in beta. Everything it can do today is free while we
                get it right. Paid plans will come later — and we&apos;ll tell you
                clearly before anything changes.
              </p>
            </div>

            {/* CTA */}
            <Link
              href="/login?signup=1"
              className="text-lg font-medium text-black hover:opacity-70 transition-opacity"
            >
              Get Started
            </Link>

            {/* Divider with label */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-black/10" />
              <p className="text-sm text-[#6b6f76]">Included today</p>
              <div className="flex-1 h-px bg-black/10" />
            </div>

            {/* Feature list */}
            <ul className="flex flex-col gap-2">
              {includedFeatures.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <CheckIcon />
                  <span className="text-sm text-black">{feature}</span>
                </li>
              ))}
            </ul>

            {/* Divider with label */}
            <div className="flex items-center gap-3 mt-2">
              <div className="flex-1 h-px bg-black/10" />
              <p className="text-sm text-[#6b6f76]">Coming later</p>
              <div className="flex-1 h-px bg-black/10" />
            </div>

            <ul className="flex flex-col gap-2">
              {plannedFeatures.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <ClockIcon />
                  <span className="text-sm text-[#6b6f76]">{feature} — not available yet</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-sm text-[#6b6f76] mt-4">
            Have a team or enterprise use case?{" "}
            <a
              href="mailto:admin@flowdeskinbox.com"
              className="text-black underline underline-offset-2 hover:opacity-70 transition-opacity"
            >
              Talk to us
            </a>
            .
          </p>
        </ScrollReveal>
      </div>
    </section>
  );
}
