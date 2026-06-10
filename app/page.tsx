import Link from "next/link";
import Nav from "@/app/components/landing/Nav";
import Hero from "@/app/components/landing/Hero";
import Features from "@/app/components/landing/Features";
import HowItWorks from "@/app/components/landing/HowItWorks";
import SocialProof from "@/app/components/landing/SocialProof";
import Pricing from "@/app/components/landing/Pricing";
import FAQ from "@/app/components/landing/FAQ";
import FinalCTA from "@/app/components/landing/FinalCTA";

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
      <footer className="border-t border-neutral-100 py-6 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-neutral-400">
            © {new Date().getFullYear()} FlowDesk. All rights reserved.
          </p>
          <div className="flex items-center gap-5">
            <Link href="/login" className="text-xs text-neutral-400 hover:text-neutral-700 transition-colors">
              Sign in
            </Link>
            <Link href="/login?signup=1" className="text-xs text-neutral-400 hover:text-neutral-700 transition-colors">
              Sign up
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
