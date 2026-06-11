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

  function onSectionClick(
    event: React.MouseEvent<HTMLAnchorElement>,
    href: string
  ) {
    event.preventDefault();
    setMenuOpen(false);
    scrollToLandingSection(href);
  }

  return (
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-neutral-100 relative">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <a href="/" className="text-lg font-semibold tracking-tight text-neutral-900">
          FlowDesk
        </a>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-8" aria-label="Main navigation">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(event) => onSectionClick(event, link.href)}
              className="text-sm text-neutral-500 hover:text-neutral-900 transition-colors"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Desktop actions */}
        <div className="hidden md:flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm text-neutral-500 hover:text-neutral-900 transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/login?signup=1"
            className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 transition-colors"
          >
            Get started
          </Link>
        </div>

        {/* Mobile: Sign in link + hamburger */}
        <div className="md:hidden flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm text-neutral-500 hover:text-neutral-900 transition-colors"
          >
            Sign in
          </Link>
          <button
            type="button"
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
            className="p-2 rounded-md text-neutral-500 hover:text-neutral-900"
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile dropdown — absolutely positioned so it overlays page content without pushing it down */}
      <div
        className={`md:hidden absolute inset-x-0 top-full bg-white/95 backdrop-blur-sm border-b border-neutral-100 shadow-lg shadow-neutral-900/5 overflow-hidden transition-all duration-300 ease-in-out ${
          menuOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0 pointer-events-none"
        }`}
      >
        <div className="px-4 sm:px-6 py-2 flex flex-col">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(event) => onSectionClick(event, link.href)}
              className="py-3 text-sm text-neutral-600 hover:text-neutral-900 transition-colors border-b border-neutral-50"
            >
              {link.label}
            </a>
          ))}
          <Link
            href="/login?signup=1"
            onClick={() => setMenuOpen(false)}
            className="my-4 inline-flex items-center justify-center rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 transition-colors"
          >
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
