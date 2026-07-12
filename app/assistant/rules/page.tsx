import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import SenderRulesPanel from "@/app/settings/SenderRulesPanel";
import { actionChipsForRule, summarizeAssistantRules } from "@/lib/assistant-rule-view";
import { builtInRuleRows } from "@/lib/built-in-rule-view";

export const dynamic = "force-dynamic";

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-2xl font-semibold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  draft: "bg-amber-100 text-amber-700",
  paused: "bg-slate-100 text-slate-600",
};

function conditionSummary(c: Record<string, string>): string {
  const parts: string[] = [];
  if (c.matchType === "email" && c.matchValue) parts.push(`from ${c.matchValue}`);
  if (c.matchType === "domain" && c.matchValue) parts.push(`from @${c.matchValue}`);
  if (c.subjectContains) parts.push(`subject has "${c.subjectContains}"`);
  if (c.bodyContains) parts.push(`body has "${c.bodyContains}"`);
  return parts.join(", ");
}

export default async function AssistantRulesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) redirect("/login");
  const tenantId = session.user.tenantId;

  const [senderRules, agentRulesRaw, gmailLabelMappings] = await Promise.all([
    prisma.senderRule.findMany({
      where: { tenantId, status: { in: ["suggested", "active"] } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.agentRule.findMany({
      where: { tenantId, status: { not: "dismissed" } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.gmailLabelMapping.findMany({
      where: { tenantId },
      select: { canonical: true, enabled: true },
    }),
  ]);
  const builtInRules = builtInRuleRows(gmailLabelMappings);

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

  // AgentRule.source is only ever "manual" or "plain_english" in this
  // codebase (see lib/agent/rule-compiler.ts) — no AgentRule is ever tagged
  // "learned". A SenderRule that reached "active" status got there via the
  // suggest -> accept flow in SenderRulesPanel below, i.e. it really was
  // learned from repeated user behavior, so that's the real "learned" count.
  const learnedCount = senderRules.filter((r) => r.status === "active").length;

  const lastTestedLabel = summary.lastDryRunAt
    ? new Date(summary.lastDryRunAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "Never";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-900">Rules</h2>
      <p className="mb-4 text-sm text-slate-500">
        Active, draft, and learned rules the agent uses to label and route mail.
      </p>

      <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Built-in label rules</h3>
            <p className="text-xs text-slate-500">Enabled automatically when FlowDesk connects to Gmail.</p>
          </div>
          <Link href="/settings/gmail" className="text-xs font-medium text-[var(--color-accent)] hover:underline">Manage labels →</Link>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {builtInRules.map((rule) => (
            <div key={rule.label} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
              <div><p className="text-xs font-semibold text-slate-800">{rule.label}</p><p className="mt-0.5 text-[11px] text-slate-500">{rule.description}</p></div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${rule.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{rule.enabled ? "Enabled" : "Disabled"}</span>
            </div>
          ))}
        </div>
      </div>

      <h3 className="mb-3 text-sm font-semibold text-slate-900">Your rules</h3>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Active rules" value={summary.active} />
        <Stat label="Draft rules" value={summary.draft} />
        <Stat label="Learned from behavior" value={learnedCount} />
        <Stat label="Last tested" value={lastTestedLabel} />
      </div>

      {agentRules.length === 0 ? (
        <div className="mb-6 rounded-lg border border-dashed border-slate-300 p-8 text-center">
          <p className="text-sm font-medium text-slate-700">No rules yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            Describe a rule in plain English, or build one from sender, subject, or body
            conditions below — then preview it before it touches real mail.
          </p>
          <Link
            href="/assistant/settings"
            className="mt-4 inline-block rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
          >
            Train My Agent
          </Link>
        </div>
      ) : (
        <div className="mb-6 overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-500">Enabled</th>
                <th className="px-3 py-2 text-left font-medium text-slate-500">Name</th>
                <th className="px-3 py-2 text-left font-medium text-slate-500">Prompt</th>
                <th
                  className="px-3 py-2 text-left font-medium text-slate-500"
                  title="e.g. Label as 'Needs Reply'"
                >
                  Action
                </th>
                <th className="px-3 py-2 text-left font-medium text-slate-500">Last tested</th>
                <th className="px-3 py-2 text-left font-medium text-slate-500">Menu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {agentRules.map((rule) => {
                const chips = actionChipsForRule(rule.actionJson);
                const name =
                  (rule.source === "manual" ? conditionSummary(rule.conditionsJson) : "") ||
                  rule.plainText;
                return (
                  <tr key={rule.id}>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                          STATUS_BADGE[rule.status] ?? "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {rule.status}
                      </span>
                    </td>
                    <td className="max-w-xs px-3 py-2 text-slate-700">{name}</td>
                    <td className="max-w-xs truncate px-3 py-2 text-slate-500" title={rule.plainText}>
                      {rule.plainText}
                    </td>
                    <td className="px-3 py-2">
                      {chips.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {chips.map((chip) => (
                            <span
                              key={chip}
                              className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600"
                            >
                              {chip}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">No action set</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {rule.lastDryRunAt ? new Date(rule.lastDryRunAt).toLocaleDateString() : "Never"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="flex gap-2">
                        <Link
                          href="/assistant/test-rules"
                          className="text-slate-500 underline hover:text-slate-700"
                        >
                          Test
                        </Link>
                        {rule.source === "manual" && (
                          <span className="text-slate-400">Manage below</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <SenderRulesPanel initialRules={senderRules} initialStaticRules={staticRules} />
    </section>
  );
}
