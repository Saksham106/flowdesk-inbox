import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import SenderRulesPanel from "@/app/settings/SenderRulesPanel";
import { summarizeAssistantRules } from "@/lib/assistant-rule-view";

export const dynamic = "force-dynamic";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-2xl font-semibold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

export default async function AssistantRulesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) redirect("/login");

  const [senderRules, agentRulesRaw] = await Promise.all([
    prisma.senderRule.findMany({
      where: { tenantId: session.user.tenantId, status: { in: ["suggested", "active"] } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.agentRule.findMany({
      where: { tenantId: session.user.tenantId, status: { not: "dismissed" } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const agentRules = agentRulesRaw.map((r) => ({
    id: r.id,
    plainText: r.plainText,
    ruleType: r.ruleType,
    conditionsJson: (r.conditionsJson ?? {}) as Record<string, string>,
    actionJson: (r.actionJson ?? {}) as Record<string, string>,
    status: r.status,
    source: r.source,
    version: r.version,
    lastDryRunAt: r.lastDryRunAt?.toISOString() ?? null,
  }));

  // Manually-built static rules are managed here (dry-run preview, enable
  // gate, version history); plain-English rules stay in Train My Agent.
  const staticRules = agentRules.filter((r) => r.source === "manual");
  const summary = summarizeAssistantRules(agentRules);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-900">Rules</h2>
      <p className="mb-4 text-sm text-slate-500">
        Active, draft, and learned rules the agent uses to label and route mail.
      </p>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Active" value={summary.active} />
        <Stat label="Draft" value={summary.draft} />
        <Stat label="Manual" value={summary.manual} />
        <Stat label="Learned" value={summary.learned} />
      </div>
      <SenderRulesPanel initialRules={senderRules} initialStaticRules={staticRules} />
    </section>
  );
}
