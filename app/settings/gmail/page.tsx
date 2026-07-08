import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import FixGmailLabelsButton from "@/app/settings/FixGmailLabelsButton";
import GmailLabelSettingsPanel from "@/app/settings/GmailLabelSettingsPanel";
import { FLOWDESK_GMAIL_LABEL_NAMES } from "@/lib/gmail-labels";

export const dynamic = "force-dynamic";

export default async function GmailSettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) redirect("/login");

  const [gmailChannelCount, gmailLabelMappings] = await Promise.all([
    prisma.channel.count({
      where: { tenantId: session.user.tenantId, type: "email", provider: "google" },
    }),
    prisma.gmailLabelMapping.findMany({
      where: { tenantId: session.user.tenantId },
      select: { canonical: true, enabled: true },
    }),
  ]);

  if (gmailChannelCount === 0) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-600">
          Connect Gmail first to configure how FlowDesk labels your inbox.{" "}
          <Link href="/settings/connect" className="font-medium underline">
            Go to Connect
          </Link>
          .
        </p>
      </section>
    );
  }

  const gmailLabelEnabledByCanonical = new Map(gmailLabelMappings.map((m) => [m.canonical, m.enabled]));
  const gmailLabelSettings = FLOWDESK_GMAIL_LABEL_NAMES.map((canonical) => ({
    canonical,
    enabled: gmailLabelEnabledByCanonical.get(canonical) ?? true,
  }));

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-6 py-4">
        <h2 className="font-semibold">Gmail Labels</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          FlowDesk organizes your inbox with these labels directly in Gmail,
          so it&apos;s already sorted when you open it.
        </p>
      </div>
      <div className="px-6 py-5 space-y-4">
        <FixGmailLabelsButton />
        <GmailLabelSettingsPanel initial={gmailLabelSettings} />
      </div>
    </section>
  );
}
