"use client";

import { useState } from "react";
import ScrollReveal from "@/app/components/ScrollReveal";

const faqs = [
  {
    q: "Will FlowDesk send emails without asking me?",
    a: "Not unless you tell it to. By default FlowDesk works as a copilot: it drafts replies and waits for your approval on every send. If you want, you can turn up the automation for specific kinds of email — and everything it does is logged and undoable.",
  },
  {
    q: "How long does setup take?",
    a: "A few minutes. Sign in with Google, and FlowDesk learns your writing style from emails you've already sent. There's nothing to install and nothing to configure before it starts helping.",
  },
  {
    q: "Do I have to stop using Gmail?",
    a: "No — FlowDesk works inside your Gmail, not instead of it. Labels, drafts, and threads all live in your real inbox, so everything works exactly as before in the Gmail apps you already use.",
  },
  {
    q: "How does FlowDesk use my Gmail data?",
    a: "FlowDesk connects to Gmail through Google OAuth to read and classify your inbox, apply labels, and create drafts and replies that you approve. Your email is never sold, never used for advertising, and never used to train AI models, and you can disconnect at any time to delete your synced data. See our Privacy Policy for the full details.",
  },
  {
    q: "What happens if I disconnect?",
    a: "Your synced data is deleted from FlowDesk, and your Gmail stays exactly as it is — your emails, labels, and drafts remain in your Google account, which always stays the source of truth.",
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
            <div className="flex flex-col gap-2">
              <p className="text-xs uppercase tracking-[0.14em] text-[#6b6f76] font-medium">FAQ</p>
              <h2
                className="text-[36px] leading-[1.15] font-normal text-black"
                style={{ fontFamily: "var(--font-lora), Georgia, serif" }}
              >
                Questions before you hand over your inbox?
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
