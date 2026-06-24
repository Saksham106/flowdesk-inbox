import Link from "next/link";
import Nav from "@/app/components/landing/Nav";
import Hero from "@/app/components/landing/Hero";
import Features from "@/app/components/landing/Features";
import HowItWorks from "@/app/components/landing/HowItWorks";
import SocialProof from "@/app/components/landing/SocialProof";
import Pricing from "@/app/components/landing/Pricing";
import FAQ from "@/app/components/landing/FAQ";
import FinalCTA from "@/app/components/landing/FinalCTA";
import Logo from "@/app/components/landing/Logo";

export default function Home() {
  return (
    <div className="bg-white text-neutral-900">
      <Nav />
      <main>
        <Hero />
        <SocialProof />
        <Features />
        <HowItWorks />
        <Pricing />
        <FAQ />
        <FinalCTA />
      </main>

      <footer id="page-footer" className="bg-white border-t border-black/[0.08] px-5 sm:px-8 py-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start justify-between gap-8">
          {/* Logo */}
          <div className="px-3">
            <Logo size="sm" />
          </div>

          {/* Footer nav columns */}
          <div className="flex gap-14">
            <div className="flex flex-col gap-2.5">
              <p className="text-[13px] font-semibold text-[#141a3d]">Social</p>
              <div className="h-1.5" />
              {["GitHub", "X (formerly Twitter)", "LinkedIn"].map((item) => (
                <p key={item} className="text-[13px] text-[#595961] cursor-pointer hover:text-black transition-colors">{item}</p>
              ))}
            </div>

            <div className="flex flex-col gap-2.5">
              <p className="text-[13px] font-semibold text-[#141a3d]">Company</p>
              <div className="h-1.5" />
              {[
                { label: "Blog", href: "#" },
                { label: "Contact Us", href: "#" },
                { label: "Terms of Service", href: "#" },
                { label: "Privacy Policy", href: "#" },
              ].map((item) => (
                <Link key={item.label} href={item.href} className="text-[13px] text-[#595961] hover:text-black transition-colors">
                  {item.label}
                </Link>
              ))}
            </div>

            <div className="flex flex-col gap-2.5">
              <p className="text-[13px] font-semibold text-[#141a3d]">Tools</p>
              <div className="h-1.5" />
              {["Gmail", "Google Calendar"].map((item) => (
                <p key={item} className="text-[13px] text-[#595961] cursor-pointer hover:text-black transition-colors">{item}</p>
              ))}
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto mt-8 pt-6 border-t border-black/[0.06]">
          <p className="text-xs text-[#595961]">
            © {new Date().getFullYear()} Flowdesk. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
