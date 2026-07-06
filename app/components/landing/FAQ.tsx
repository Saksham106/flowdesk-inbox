"use client";

import { useState } from "react";
import ScrollReveal from "@/app/components/ScrollReveal";

const faqs = [
  {
    q: "What languages does Flowdesk support?",
    a: "Flowdesk supports English, Spanish, French, German, Portuguese, and more. Our AI adapts to the language of the conversation automatically.",
  },
  {
    q: "How long does setup take?",
    a: "Most teams are set up within 15 minutes. Connect your email accounts and claim a phone number — that's it. No engineering work required.",
  },
  {
    q: "Can Flowdesk reply automatically on my behalf?",
    a: "By default, Flowdesk uses Copilot mode: it drafts replies for your review and you approve every send. For specific approved categories, you can optionally enable Autopilot — but only for the workflows you define.",
  },
  {
    q: "Which channels does Flowdesk support?",
    a: "At launch, Flowdesk supports email and SMS/text via a dedicated phone number. More channels are on the roadmap.",
  },
];

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);

  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      className="w-full bg-[#f5f5f4] rounded-lg overflow-hidden text-left"
      aria-expanded={open}
    >
      <div className="flex items-center justify-between p-5 gap-4">
        <span className="text-base font-normal text-black">{q}</span>
        <div className="shrink-0 text-black">
          {open ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          )}
        </div>
      </div>
      <div
        className={`overflow-hidden transition-all duration-200 ease-in-out ${
          open ? "max-h-48" : "max-h-0"
        }`}
      >
        <p className="px-5 pb-5 text-sm text-[#6b6f76] leading-relaxed text-left">{a}</p>
      </div>
    </button>
  );
}

export default function FAQ() {
  return (
    <section id="faq" className="py-20 px-5 sm:px-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col lg:flex-row gap-8 items-start">
          {/* Left: heading */}
          <ScrollReveal className="flex-1 min-w-0">
            <div className="flex flex-col gap-1">
              <p className="text-sm text-black font-normal">{"// FAQ"}</p>
              <h2 className="text-[36px] leading-[1.1] font-normal text-black">
                Questions before you hand off follow-up?
              </h2>
            </div>
          </ScrollReveal>

          {/* Right: FAQ list */}
          <div className="flex-1 min-w-0 flex flex-col gap-3 w-full">
            {faqs.map((item, i) => (
              <ScrollReveal key={item.q} delay={i * 80}>
                <FAQItem q={item.q} a={item.a} />
              </ScrollReveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
