import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Lora } from "next/font/google";
import "./globals.css";
import Providers from "@/app/providers";

const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "FlowDesk — your personal AI email assistant for Gmail",
  description: "FlowDesk lives inside your Gmail. It sorts what matters, drafts replies in your voice, and tracks follow-ups — you approve every send.",
  openGraph: {
    title: "FlowDesk — your personal AI email assistant for Gmail",
    description: "FlowDesk lives inside your Gmail. It sorts what matters, drafts replies in your voice, and tracks follow-ups — you approve every send.",
    type: "website",
    images: [{ url: "/images/landing/product-screenshot.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "FlowDesk — your personal AI email assistant for Gmail",
    description: "FlowDesk lives inside your Gmail. It sorts what matters, drafts replies in your voice, and tracks follow-ups — you approve every send.",
    images: ["/images/landing/product-screenshot.png"],
  },
  verification: {
    google: "pyMDQ5KOTxYPA_gLE5zLvUOzSdEPLNHEnSKfemlVV2c",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} ${lora.variable} antialiased bg-slate-50 text-slate-900`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
