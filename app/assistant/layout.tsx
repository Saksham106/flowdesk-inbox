import Link from "next/link";
import type { ReactNode } from "react";

import AssistantTabNav from "@/app/assistant/AssistantTabNav";

export default function AssistantLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6 py-4">
          <div>
            <Link href="/home" className="text-sm text-slate-500 hover:text-slate-700">
              &larr; Back to control room
            </Link>
            <h1 className="mt-1 text-xl font-semibold">Assistant</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Rules the agent uses to triage and act on your inbox.
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <AssistantTabNav />
        <div className="space-y-10">{children}</div>
      </main>
    </div>
  );
}
