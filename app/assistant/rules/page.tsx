import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import SenderRulesPanel from "@/app/settings/SenderRulesPanel";

export const dynamic = "force-dynamic";

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

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-900">Rules</h2>
      <p className="mb-4 text-sm text-slate-500">
        Active, draft, and learned rules the agent uses to label and route mail.
      </p>
      <SenderRulesPanel initialRules={senderRules} initialStaticRules={staticRules} />
    </section>
  );
}
