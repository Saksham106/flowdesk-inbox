"use client";

import { useState } from "react";
import ScrollReveal from "@/app/components/ScrollReveal";

const faqs = [
  {
    q: "How long does setup take?",
    a: "Most teams are set up within 15 minutes. Connect your email accounts and claim a phone number — that's it. No engineering work required.",
  },
  {
    q: "Can FlowDesk reply automatically on my behalf?",
    a: "By default, FlowDesk uses Copilot mode: it drafts replies for your review and you approve every send. For specific approved categories, you can optionally enable Autopilot — but only for the workflows you define. Every automated send is logged, and you can override or disable it at any time.",
  },
  {
    q: "Which channels does FlowDesk support?",
    a: "At launch, FlowDesk supports email and SMS/text via a dedicated phone number. More channels are on the roadmap.",
  },
  {
    q: "Can my whole team use it?",
    a: "Yes. Starter supports up to 3 team members; Pro is unlimited. You can assign conversations, set role-based permissions, and see a full activity log across your team.",
  },
  {
    q: "Can I keep my existing phone number?",
    a: "Number porting support is in progress and will be available before the public launch. In the meantime, you can forward from your current number to a FlowDesk number.",
  },
];

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-neutral-100 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 py-5 text-left group"
        aria-expanded={open}
      >
        <span className="text-sm font-medium text-neutral-900 group-hover:text-indigo-600 transition-colors">
          {q}
        </span>
        <div
          className={`shrink-0 h-6 w-6 rounded-full border flex items-center justify-center transition-all duration-200 ${
            open
              ? "bg-indigo-50 border-indigo-200 rotate-180"
              : "bg-white border-neutral-200"
          }`}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={`transition-colors ${open ? "text-indigo-500" : "text-neutral-400"}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          open ? "max-h-48 pb-5" : "max-h-0"
        }`}
      >
        <p className="text-sm text-neutral-500 leading-relaxed">{a}</p>
      </div>
    </div>
  );
}

export default function FAQ() {
  return (
    <section id="faq" className="py-20 px-4 sm:px-6 bg-white border-t border-neutral-100">
      <div className="max-w-6xl mx-auto">
        <ScrollReveal>
          <div className="text-center mb-12">
            <p className="text-[11px] font-mono uppercase tracking-widest text-neutral-400 mb-3">FAQ</p>
            <h2 className="font-serif text-3xl sm:text-4xl text-neutral-900">Common questions.</h2>
          </div>
        </ScrollReveal>

        <ScrollReveal delay={100} className="max-w-2xl mx-auto">
          <div className="rounded-2xl border border-neutral-100 bg-white px-5 sm:px-8 shadow-sm shadow-neutral-900/[0.04]">
            {faqs.map((item) => (
              <FAQItem key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
