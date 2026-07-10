import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { salesCrmEnabled } from "@/lib/tenant-capabilities";
import ConnectedAppsPanel from "@/app/settings/ConnectedAppsPanel";
import AiBudgetPanel from "@/app/settings/AiBudgetPanel";
import AiUsagePanel from "@/app/settings/AiUsagePanel";
import { getAiBudgetStatus } from "@/lib/ai/budget";
import { startOfMonthUtc, summarizeAiUsage } from "@/lib/ai/usage-summary";

export const dynamic = "force-dynamic";

export default async function DataSettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) redirect("/login");

  const [googleDriveCredential, aiBudgetStatus, tenant, aiUsageEvents] = await Promise.all([
    prisma.googleDriveCredential.findUnique({
      where: { tenantId: session.user.tenantId },
    }),
    getAiBudgetStatus(session.user.tenantId),
    prisma.tenant.findUnique({
      where: { id: session.user.tenantId },
      select: { salesCrmEnabled: true },
    }),
    prisma.aiUsageEvent.findMany({
      where: { tenantId: session.user.tenantId, createdAt: { gte: startOfMonthUtc(new Date()) } },
      select: {
        feature: true,
        estimatedCostUsd: true,
        actualCostUsd: true,
        status: true,
        createdAt: true,
        userId: true,
        provider: true,
      },
    }),
  ]);

  const isPersonal = !salesCrmEnabled(tenant);

  const aiUsageSummary = summarizeAiUsage(aiUsageEvents, {
    dailyLimitUsd: aiBudgetStatus.dailyLimitUsd,
    monthlyLimitUsd: aiBudgetStatus.monthlyLimitUsd,
  });

  return (
    <>
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="font-semibold">Your data</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            What FlowDesk stores, who processes it, and how to delete it.
          </p>
        </div>
        <div className="px-6 py-5">
          <ul className="space-y-2 text-sm text-slate-600">
            <li>
              <span className="font-medium text-slate-900">What we store:</span> your synced
              email messages, their classifications, drafts, and an audit log of every action
              FlowDesk takes. OAuth tokens are encrypted at rest.
            </li>
            <li>
              <span className="font-medium text-slate-900">AI processing:</span> portions of
              email content are sent to OpenRouter (using per-user provisioned API keys) to
              classify messages and generate drafts. Your email is never sold, never used for
              ads, and never used to train AI models.
            </li>
            <li>
              <span className="font-medium text-slate-900">Deletion:</span> disconnecting Gmail
              (under{" "}
              <Link href="/settings/connect" className="underline underline-offset-2 hover:text-slate-900">
                Connect
              </Link>
              ) permanently deletes its synced messages, classifications,
              and drafts from FlowDesk. For full account deletion, email{" "}
              <a
                href="mailto:admin@flowdeskinbox.com"
                className="underline underline-offset-2 hover:text-slate-900"
              >
                admin@flowdeskinbox.com
              </a>
              .
            </li>
          </ul>
          <p className="mt-3 text-sm text-slate-500">
            Full details in the{" "}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-slate-700">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </section>

      {/* Google Drive context injection is not built yet, so the connect entry
          point is off the default path; still shown when already connected so
          the credential stays manageable */}
      {(!isPersonal || googleDriveCredential) && (
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4">
            <h2 className="font-semibold">Connected Apps</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Choose integrations that help your workflows, not just logo counts.
            </p>
          </div>
          <div className="px-6 py-5">
            <ConnectedAppsPanel
              driveConnected={!!googleDriveCredential}
              driveEmail={googleDriveCredential?.email}
            />
          </div>
        </section>
      )}

      <section id="ai-usage" className="scroll-mt-24 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="font-semibold">AI Usage</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            What each AI feature has spent this period, and how much budget is left.
          </p>
        </div>
        <div className="px-6 py-5">
          <AiUsagePanel summary={aiUsageSummary} />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="font-semibold">AI Spend Budget</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Set daily and monthly limits for AI usage (drafts, explanations, lead scoring). Calls that would
            exceed a limit are blocked automatically.
          </p>
        </div>
        <div className="px-6 py-5">
          <AiBudgetPanel initial={aiBudgetStatus} />
        </div>
      </section>
    </>
  );
}
