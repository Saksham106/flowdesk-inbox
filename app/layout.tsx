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
  title: "Flowdesk Inbox",
  description: "AI inbox for small business support",
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
