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
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-neutral-100">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <a href="/" className="text-lg font-semibold tracking-tight text-neutral-900">
          FlowDesk
        </a>

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

        <button
          type="button"
          aria-label="Toggle menu"
          className="md:hidden p-2 rounded-md text-neutral-500 hover:text-neutral-900"
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

      {menuOpen && (
        <div className="md:hidden border-t border-neutral-100 bg-white px-6 py-4 flex flex-col gap-4">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(event) => onSectionClick(event, link.href)}
              className="text-sm text-neutral-600 hover:text-neutral-900 transition-colors"
            >
              {link.label}
            </a>
          ))}
          <Link
            href="/login"
            onClick={() => setMenuOpen(false)}
            className="text-sm text-neutral-600 hover:text-neutral-900 transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/login?signup=1"
            onClick={() => setMenuOpen(false)}
            className="mt-2 inline-flex items-center justify-center rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 transition-colors"
          >
            Get started
          </Link>
        </div>
      )}
    </header>
  );
}
