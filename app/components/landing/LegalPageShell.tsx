import Link from "next/link";
import type { ReactNode } from "react";
import Logo from "@/app/components/landing/Logo";

// Shared shell for /privacy and /terms: landing-page light theme, minimal
// header (no section-anchor nav — those anchors only exist on the landing
// page), and a small footer cross-linking the two legal pages.
export default function LegalPageShell({
  label,
  title,
  lastUpdated,
  children,
}: {
  label: string;
  title: string;
  lastUpdated: string;
  children: ReactNode;
}) {
  return (
    <div className="bg-white text-neutral-900 min-h-screen flex flex-col">
      <header className="border-b border-black/[0.08] px-5 sm:px-8 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Logo size="sm" />
          <Link href="/" className="text-[13px] text-[#595961] hover:text-black transition-colors">
            &larr; Back to home
          </Link>
        </div>
      </header>

      <main className="flex-1 px-5 sm:px-8 py-16">
        <article className="max-w-3xl mx-auto">
          <p className="text-sm text-black font-normal">{`// ${label}`}</p>
          <h1 className="text-[36px] leading-[1.1] font-normal text-black mt-2">{title}</h1>
          <p className="text-sm text-[#6b6f76] mt-3">Last updated: {lastUpdated}</p>

          <div
            className="mt-10 flex flex-col gap-4 text-[15px] leading-relaxed text-[#3f3f42]
              [&_h2]:text-xl [&_h2]:font-medium [&_h2]:text-black [&_h2]:mt-6
              [&_h3]:text-base [&_h3]:font-medium [&_h3]:text-black [&_h3]:mt-2
              [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5
              [&_a]:underline [&_a]:underline-offset-2 [&_a]:text-black
              [&_strong]:font-medium [&_strong]:text-black"
          >
            {children}
          </div>
        </article>
      </main>

      <footer className="border-t border-black/[0.08] px-5 sm:px-8 py-6">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <p className="text-xs text-[#595961]">
            © {new Date().getFullYear()} Flowdesk. All rights reserved.
          </p>
          <div className="flex gap-5">
            <Link href="/privacy" className="text-xs text-[#595961] hover:text-black transition-colors">
              Privacy Policy
            </Link>
            <Link href="/terms" className="text-xs text-[#595961] hover:text-black transition-colors">
              Terms of Service
            </Link>
            <a href="mailto:admin@flowdeskinbox.com" className="text-xs text-[#595961] hover:text-black transition-colors">
              Contact
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
