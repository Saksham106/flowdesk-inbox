import Link from "next/link";

const CTA_BG = "/images/landing/cta-bg.png";

export default function FinalCTA() {
  return (
    <section id="final-cta" className="py-10 px-5 sm:px-8">
      <div className="max-w-6xl mx-auto">
        <div className="relative rounded-lg overflow-hidden flex items-center justify-center" style={{ minHeight: 440 }}>
          {/* Background image with overlay */}
          <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
            <img
              src={CTA_BG}
              alt=""
              className="absolute inset-0 w-full h-full object-cover opacity-80"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/55" />
          </div>

          {/* Content */}
          <div className="relative z-10 flex flex-col items-center gap-7 px-8 py-16 text-center w-full max-w-3xl mx-auto">
            <h2
              className="text-[56px] leading-[66px] font-normal text-white"
              style={{ fontFamily: "var(--font-lora), Georgia, serif" }}
            >
              Ready to outsource your communication?
            </h2>

            <Link
              href="/login?signup=1"
              className="inline-flex items-center justify-center bg-black text-white text-sm rounded px-6 py-2 hover:opacity-85 transition-opacity"
            >
              Get started free
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
