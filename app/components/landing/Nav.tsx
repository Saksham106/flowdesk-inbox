"use client";

import { useState } from "react";
import Link from "next/link";
import { scrollToLandingSection } from "@/lib/client-navigation";

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

export default function Nav() {
  const [menuOpen, setMenuOpen] = useState(false);

  function onSectionClick(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    e.preventDefault();
    setMenuOpen(false);
    scrollToLandingSection(href);
  }

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-black/[0.08]">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 h-[72px] flex items-center justify-between">
        {/* Logo */}
        <a href="/" className="flex items-center gap-2 shrink-0">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <rect width="28" height="28" rx="6" fill="#111" />
            <path d="M8 14h12M14 8l6 6-6 6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-[15px] font-semibold text-black tracking-tight">Flowdesk</span>
        </a>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-7" aria-label="Main navigation">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(e) => onSectionClick(e, link.href)}
              className="text-sm text-[#404040] hover:text-black transition-colors"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Desktop actions */}
        <div className="hidden md:flex items-center gap-2">
          <Link
            href="/login"
            className="px-5 py-2 text-sm text-black border border-[#4a4a4a] rounded-lg hover:bg-neutral-50 transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/login?signup=1"
            className="px-5 py-2 text-sm font-medium text-white bg-black rounded-lg hover:opacity-85 transition-opacity"
          >
            Get started
          </Link>
        </div>

        {/* Mobile */}
        <div className="md:hidden flex items-center gap-3">
          <Link href="/login" className="text-sm text-[#404040]">
            Sign in
          </Link>
          <button
            type="button"
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
            className="p-2 rounded-md text-black"
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      <div
        className={`md:hidden absolute inset-x-0 top-full overflow-hidden transition-all duration-300 ease-in-out bg-white border-b border-black/[0.08] ${
          menuOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0 pointer-events-none"
        }`}
      >
        <div className="px-5 py-2 flex flex-col">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(e) => onSectionClick(e, link.href)}
              className="py-3 text-sm text-[#404040] hover:text-black border-b border-black/[0.06] last:border-0 transition-colors"
            >
              {link.label}
            </a>
          ))}
          <Link
            href="/login?signup=1"
            onClick={() => setMenuOpen(false)}
            className="my-4 inline-flex items-center justify-center rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white hover:opacity-85 transition-opacity"
          >
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
