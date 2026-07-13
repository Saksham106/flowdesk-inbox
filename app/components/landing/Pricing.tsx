import Link from "next/link";
import ScrollReveal from "@/app/components/ScrollReveal";

function CheckIcon({ inverted = false }: { inverted?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 mt-0.5" aria-hidden="true">
      <circle cx="8" cy="8" r="8" fill={inverted ? "white" : "#1a1a1a"} />
      <polyline
        points="4.5,8.5 7,11 11.5,5.5"
        stroke={inverted ? "#1a1a1a" : "white"}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

interface Plan {
  name: string;
  price: string;
  description: string;
  listLabel: string;
  features: string[];
  featured?: boolean;
}

const plans: Plan[] = [
  {
    name: "Free",
    price: "0",
    description: "A tidy inbox and a taste of drafts in your voice.",
    listLabel: "What's included",
    features: [
      "Connect your Gmail account",
      "Automatic classification & Gmail labels",
      "Clean Inbox — bulk cleanup & unsubscribe, with one-hour undo",
      "10 AI reply drafts per month, written in your voice",
      "Waiting-on & follow-up tracking",
      "Approvals, full audit log & undo",
    ],
  },
  {
    name: "Pro",
    price: "7",
    description: "Real day-to-day autopilot — it drafts and files, you send.",
    listLabel: "Everything in Free, and:",
    features: [
      "200 AI reply drafts per month",
      "Auto-archive — FlowDesk files the noise on its own",
      "Meeting slots proposed right in your drafts",
      "Unlimited custom rules & Ask FlowDesk chat",
      "Connect a second email account",
      "Higher automation levels, still fully logged & undoable",
    ],
    featured: true,
  },
  {
    name: "Max",
    price: "20",
    description: "Full autopilot — it can send, book, and track deals for you.",
    listLabel: "Everything in Pro, and:",
    features: [
      "Unlimited AI reply drafts",
      "Auto-send for the senders and email types you choose",
      "Auto-booking — confirmed times go straight on your calendar",
      "Sales & CRM — leads and deals tracked from your email",
      "Up to 5 connected email accounts",
      "Priority support",
    ],
  },
];

function PlanCard({ plan }: { plan: Plan }) {
  const dark = plan.featured === true;
  return (
    <div
      className={`landing-card relative rounded-lg p-8 flex flex-col gap-6 h-full ${
        dark ? "bg-[#1a1a1a] text-white" : "bg-[#f5f5f4] text-black"
      }`}
    >
      {dark && (
        <p className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap bg-white text-black text-xs font-medium uppercase tracking-[0.14em] px-4 py-1.5 rounded-full shadow-[0_1px_4px_rgba(0,0,0,0.12)] border border-black/5">
          Most popular
        </p>
      )}

      <div className="flex flex-col gap-3">
        <p className="text-lg font-medium">{plan.name}</p>
        <p className="leading-none">
          <span
            className="text-[40px] font-medium"
            style={{ fontFamily: "var(--font-lora), Georgia, serif" }}
          >
            ${plan.price}
          </span>
          <span className={`text-base ml-1 ${dark ? "text-white/60" : "text-[#6b6f76]"}`}>
            /month
          </span>
        </p>
        <p className={`text-sm leading-relaxed ${dark ? "text-white/80" : "text-[#3f4145]"}`}>
          {plan.description}
        </p>
      </div>

      <Link
        href="/login?signup=1"
        className={`block text-center text-sm font-medium rounded-lg py-3 px-6 transition-opacity hover:opacity-80 ${
          dark ? "bg-white text-black" : "border border-black/20 text-black"
        }`}
      >
        Get started
      </Link>

      <div className={`h-px ${dark ? "bg-white/15" : "bg-black/10"}`} />

      <div className="flex flex-col gap-3">
        <p
          className={`text-xs uppercase tracking-[0.14em] font-medium ${
            dark ? "text-white/60" : "text-[#6b6f76]"
          }`}
        >
          {plan.listLabel}
        </p>
        <ul className="flex flex-col gap-2.5">
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2.5">
              <CheckIcon inverted={dark} />
              <span className={`text-sm leading-snug ${dark ? "text-white/90" : "text-black"}`}>
                {feature}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function Pricing() {
  return (
    <section id="pricing" className="py-24 px-5 sm:px-8">
      <div className="max-w-6xl mx-auto flex flex-col gap-12">
        {/* Section heading */}
        <ScrollReveal>
          <div className="flex flex-col gap-3">
            <p className="text-xs uppercase tracking-[0.14em] text-[#6b6f76] font-medium">Pricing</p>
            <h2
              className="text-[36px] leading-[1.15] font-normal text-black"
              style={{ fontFamily: "var(--font-lora), Georgia, serif" }}
            >
              Start free, add autopilot as you trust it
            </h2>
            <p className="text-base text-[#3f4145] max-w-xl">
              Every plan works inside your Gmail, and you approve every send unless
              you say otherwise.
            </p>
            <p className="text-sm text-[#6b6f76]">
              FlowDesk is in beta — every plan is free for now, and we&apos;ll tell
              you clearly before paid plans take effect.
            </p>
          </div>
        </ScrollReveal>

        {/* Plan cards */}
        <div className="grid lg:grid-cols-3 gap-6 items-stretch pt-2">
          {plans.map((plan, i) => (
            <ScrollReveal key={plan.name} delay={i * 90} className="h-full">
              <PlanCard plan={plan} />
            </ScrollReveal>
          ))}
        </div>

        <ScrollReveal>
          <p className="text-sm text-[#6b6f76]">
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
