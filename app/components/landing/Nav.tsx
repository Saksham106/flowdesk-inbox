"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { scrollToLandingSection } from "@/lib/client-navigation";

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const darkIds = ["hero", "final-cta", "page-footer"];
    const checkTheme = () => {
      const header = document.querySelector("header");
      const navBottom = header ? header.getBoundingClientRect().bottom : 64;
      const overDark = darkIds.some((id) => {
        const el = document.getElementById(id);
        if (!el) return false;
        const r = el.getBoundingClientRect();
        // inclusive: catches hero whose top is exactly at the nav bottom
        return r.top <= navBottom && r.bottom > 0;
      });
      setScrolled(!overDark);
    };
    window.addEventListener("scroll", checkTheme, { passive: true });
    checkTheme();
    return () => window.removeEventListener("scroll", checkTheme);
  }, []);

  function onSectionClick(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    e.preventDefault();
    setMenuOpen(false);
    scrollToLandingSection(href);
  }

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-white/95 backdrop-blur-md border-b border-neutral-100 shadow-sm shadow-neutral-900/5"
          : "bg-[#09090b]/95 backdrop-blur-sm border-b border-white/[0.08]"
      }`}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <a
          href="/"
          className={`text-lg font-semibold tracking-tight transition-colors duration-300 ${
            scrolled ? "text-neutral-900" : "text-white"
          }`}
        >
          FlowDesk
        </a>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-8" aria-label="Main navigation">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(e) => onSectionClick(e, link.href)}
              className={`text-sm transition-colors duration-300 ${
                scrolled
                  ? "text-neutral-500 hover:text-neutral-900"
                  : "text-white/60 hover:text-white"
              }`}
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Desktop actions */}
        <div className="hidden md:flex items-center gap-3">
          <Link
            href="/login"
            className={`text-sm transition-colors duration-300 ${
              scrolled
                ? "text-neutral-500 hover:text-neutral-900"
                : "text-white/60 hover:text-white"
            }`}
          >
            Sign in
          </Link>
          <Link
            href="/login?signup=1"
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity shadow-lg shadow-indigo-500/25"
          >
            Get started
          </Link>
        </div>

        {/* Mobile */}
        <div className="md:hidden flex items-center gap-3">
          <Link
            href="/login"
            className={`text-sm transition-colors ${
              scrolled ? "text-neutral-500" : "text-white/60"
            }`}
          >
            Sign in
          </Link>
          <button
            type="button"
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
            className={`p-2 rounded-md transition-colors ${
              scrolled
                ? "text-neutral-500 hover:text-neutral-900"
                : "text-white/60 hover:text-white"
            }`}
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
        className={`md:hidden absolute inset-x-0 top-full overflow-hidden transition-all duration-300 ease-in-out ${
          menuOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0 pointer-events-none"
        } ${
          scrolled
            ? "bg-white/95 border-b border-neutral-100"
            : "bg-[#09090b]/98 border-b border-white/10"
        } backdrop-blur-md`}
      >
        <div className="px-4 sm:px-6 py-2 flex flex-col">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(e) => onSectionClick(e, link.href)}
              className={`py-3 text-sm transition-colors border-b ${
                scrolled
                  ? "text-neutral-600 hover:text-neutral-900 border-neutral-50"
                  : "text-white/60 hover:text-white border-white/10"
              }`}
            >
              {link.label}
            </a>
          ))}
          <Link
            href="/login?signup=1"
            onClick={() => setMenuOpen(false)}
            className="my-4 inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          >
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
