import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import TrainAgentPanel from "@/app/settings/TrainAgentPanel";

export const dynamic = "force-dynamic";

export default async function AssistantSettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) redirect("/login");

  const agentRulesRaw = await prisma.agentRule.findMany({
    where: { tenantId: session.user.tenantId, status: { not: "dismissed" } },
    orderBy: { createdAt: "desc" },
  });

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

  // Manually-built static rules are managed in the Attention Rules panel
  // (dry-run preview, enable gate, version history); plain-English rules stay
  // in Train My Agent.
  const plainEnglishRules = agentRules.filter((r) => r.source !== "manual");

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-900">Assistant Settings</h2>
      <p className="mb-4 text-sm text-slate-500">
        Describe rules in plain English. FlowDesk will apply them automatically.
      </p>
      <TrainAgentPanel initialRules={plainEnglishRules} />
    </section>
  );
}
