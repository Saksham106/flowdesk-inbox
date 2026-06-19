import Link from "next/link";
import ScrollReveal from "@/app/components/ScrollReveal";

export default function FinalCTA() {
  return (
    <section id="final-cta" className="relative bg-[#09090b] py-24 px-4 sm:px-6 overflow-hidden">
      {/* Dot grid */}
      <div
        className="absolute inset-0 pointer-events-none select-none"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      {/* Center glow */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[280px] pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center top, rgba(99,102,241,0.16) 0%, transparent 65%)",
        }}
      />

      <div className="relative max-w-lg mx-auto text-center">
        <ScrollReveal>
          <p className="text-[11px] font-mono uppercase tracking-widest text-white/50 mb-5">
            Early access
          </p>
          <h2 className="font-serif text-4xl sm:text-5xl text-white mb-4 leading-tight">
            Be first in the door.
          </h2>
          <p className="text-white/65 text-base mb-10 leading-relaxed">
            We&apos;re opening access now. Create your account in under a minute.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/login?signup=1"
              className="inline-flex items-center justify-center gap-2 rounded-lg px-6 py-3 text-sm font-medium text-white hover:opacity-90 transition-opacity shadow-lg shadow-indigo-500/30"
              style={{ background: "linear-gradient(135deg, #6366f1 0%, #7c3aed 100%)" }}
            >
              Create free account
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-lg border border-white/12 bg-white/5 px-6 py-3 text-sm font-medium text-white/75 hover:bg-white/10 transition-colors"
            >
              Sign in
            </Link>
          </div>

          <p className="mt-6 text-xs text-white/45">No credit card required. Cancel any time.</p>
        </ScrollReveal>
      </div>
    </section>
  );
}
