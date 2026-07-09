import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { salesCrmEnabled } from "@/lib/tenant-capabilities";
import PersonalStylePanel from "@/app/settings/PersonalStylePanel";
import SenderRulesPanel from "@/app/settings/SenderRulesPanel";
import TrainAgentPanel from "@/app/settings/TrainAgentPanel";

export const dynamic = "force-dynamic";

export default async function TrainingSettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) redirect("/login");

  const [learnedReplyProfile, latestLearningUsage, senderRules, agentRulesRaw, tenant] = await Promise.all([
    prisma.learnedReplyProfile.findFirst({
      where: { tenantId: session.user.tenantId },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.aiUsageEvent.findFirst({
      where: { tenantId: session.user.tenantId, feature: "reply_learning.train" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.senderRule.findMany({
      where: { tenantId: session.user.tenantId, status: { in: ["suggested", "active"] } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.agentRule.findMany({
      where: { tenantId: session.user.tenantId, status: { not: "dismissed" } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.tenant.findUnique({
      where: { id: session.user.tenantId },
      select: { salesCrmEnabled: true },
    }),
  ]);

  const isPersonal = !salesCrmEnabled(tenant);

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
  const staticRules = agentRules.filter((r) => r.source === "manual");
  const plainEnglishRules = agentRules.filter((r) => r.source !== "manual");

  return (
    <>
      <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        Rules and training now have a dedicated home.{" "}
        <a href="/assistant" className="font-medium underline">
          Open Assistant →
        </a>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="font-semibold">Reply Learning</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {isPersonal
              ? "FlowDesk learns your writing style from sent emails to draft replies that sound like you."
              : "FlowDesk learns from sent staff replies to make business drafts sound more like your team."}
          </p>
        </div>
        <div className="px-6 py-5">
          <PersonalStylePanel initial={toLearnedPanelSnapshot(learnedReplyProfile, latestLearningUsage)} />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="font-semibold">Attention Rules</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Static rules run before any AI classification. Build one, preview it against your
            recent mail, then enable it. Learned sender suggestions appear here too.
          </p>
        </div>
        <div className="px-6 py-5">
          <SenderRulesPanel initialRules={senderRules} initialStaticRules={staticRules} />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="font-semibold">Train My Agent</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Describe rules in plain English. FlowDesk will apply them automatically.
          </p>
        </div>
        <div className="px-6 py-5">
          <TrainAgentPanel initialRules={plainEnglishRules} />
        </div>
      </section>
    </>
  );
}

function toLearnedPanelSnapshot(
  profile: {
    styleSummaryJson: unknown;
    exampleSnippetsJson: unknown;
    sourceStatsJson: unknown;
    lastTrainedAt: Date | null;
  } | null,
  usage: {
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    status: string;
    createdAt: Date;
  } | null
) {
  if (!profile) return null;

  const style =
    typeof profile.styleSummaryJson === "object" && profile.styleSummaryJson !== null
      ? (profile.styleSummaryJson as Record<string, unknown>)
      : {};
  const sourceStats =
    typeof profile.sourceStatsJson === "object" && profile.sourceStatsJson !== null
      ? (profile.sourceStatsJson as Record<string, unknown>)
      : {};

  return {
    toneSummary: typeof style.tone === "string" ? style.tone : null,
    greetingPatterns: typeof style.greetings === "string" ? style.greetings : null,
    signoffPatterns: typeof style.signoffs === "string" ? style.signoffs : null,
    sentenceLengthStyle: typeof style.length === "string" ? style.length : null,
    formalityLevel: typeof style.formality === "string" ? style.formality : null,
    recurringPhrasesToUse: Array.isArray(style.commonPhrases)
      ? style.commonPhrases.filter((item): item is string => typeof item === "string")
      : [],
    recurringPhrasesToAvoid: Array.isArray(style.thingsToAvoid)
      ? style.thingsToAvoid.filter((item): item is string => typeof item === "string")
      : [],
    sanitizedExamples: Array.isArray(profile.exampleSnippetsJson)
      ? profile.exampleSnippetsJson.filter((item): item is string => typeof item === "string").join("\n")
      : null,
    sampleCount: typeof sourceStats.sampleCount === "number" ? sourceStats.sampleCount : 0,
    lastTrainedAt: profile.lastTrainedAt?.toISOString() ?? null,
    lastTrainingTokens: usage ? usage.estimatedInputTokens + usage.estimatedOutputTokens : null,
    lastTrainingStatus: usage?.status ?? null,
    lastTrainingAt: usage?.createdAt.toISOString() ?? null,
  };
}
