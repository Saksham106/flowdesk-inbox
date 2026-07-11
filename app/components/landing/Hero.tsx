import Link from "next/link";
import ScrollReveal from "@/app/components/ScrollReveal";

export default function Hero() {
  return (
    <section id="hero" className="relative overflow-hidden bg-white">
      {/* Background gradient image */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <img
          alt=""
          src="/images/landing/hero-bg.png"
          width={1672}
          height={941}
          className="absolute w-[124%] h-[123%] top-[-11%] left-0 object-cover"
          aria-hidden="true"
        />
      </div>

      <div className="relative max-w-6xl mx-auto px-5 sm:px-8 flex flex-col items-center">
        {/* Headline block */}
        <div className="pt-24 pb-16 flex flex-col items-center gap-8 w-full max-w-2xl mx-auto text-center">
          <ScrollReveal delay={0}>
            <h1
              className="text-[40px] sm:text-[56px] leading-[1.15] font-normal text-black w-full"
              style={{ fontFamily: "var(--font-lora), Georgia, serif" }}
            >
              Open your inbox without the dread
            </h1>
          </ScrollReveal>

          <ScrollReveal delay={120}>
            <p className="text-base font-medium text-[#404040] max-w-xl leading-relaxed">
              FlowDesk is a personal AI assistant that lives inside your Gmail. It sorts what matters, drafts replies that sound like you, and remembers who still owes you an answer — and you approve every send.
            </p>
          </ScrollReveal>

          <ScrollReveal delay={240}>
            <div className="flex flex-wrap gap-1 justify-center">
              <Link
                href="/login?signup=1"
                className="inline-flex items-center justify-center rounded-lg bg-black px-6 py-2 text-sm text-white hover:opacity-85 transition-opacity"
              >
                Get Started
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex items-center justify-center rounded-lg border border-black px-6 py-2 text-sm text-black hover:bg-neutral-50 transition-colors"
              >
                See how it works
              </a>
            </div>
          </ScrollReveal>
        </div>

        {/* Product screenshot */}
        <ScrollReveal delay={360} className="reveal-scale w-full flex items-start justify-center pb-0">
          <div className="border border-[#e0e1ec] shadow-[0px_8px_0px_0px_rgba(0,0,0,0.25)] rounded-t-xl overflow-hidden w-full max-w-4xl">
            <img
              src="/images/landing/product-screenshot.png"
              alt="Flowdesk inbox screenshot"
              width={3832}
              height={2396}
              className="w-full object-cover object-top"
              style={{ display: "block" }}
            />
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
