import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import TrainAgentPanel from "@/app/settings/TrainAgentPanel";
import AssistantSettingsCards from "@/app/assistant/AssistantSettingsCards";

export const dynamic = "force-dynamic";

export default async function AssistantSettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) redirect("/login");
  const tenantId = session.user.tenantId;

  const [agentRulesRaw, autopilotSetting, followUpSetting, learnedReplyProfile, latestDraftUsage] =
    await Promise.all([
      prisma.agentRule.findMany({
        where: { tenantId, status: { not: "dismissed" } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.autopilotSetting.findUnique({ where: { tenantId } }),
      prisma.followUpSetting.findUnique({ where: { tenantId } }),
      // Note: "writing style" is actually backed by LearnedReplyProfile (the
      // model PersonalStylePanel trains via /api/personal-profile/train),
      // not the PersonalProfile model — PersonalProfile has a real GET/PATCH
      // API (app/api/personal-profile/route.ts) but no UI writes to it
      // anywhere in this codebase, so it would always render as untrained
      // even for tenants who have genuinely trained their style. Reflecting
      // the model users actually train avoids a misleading permanent empty
      // state here.
      prisma.learnedReplyProfile.findFirst({
        where: { tenantId },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.aiUsageEvent.findFirst({
        where: {
          tenantId,
          feature: { in: ["draft.suggest", "autopilot.draft"] },
          status: "succeeded",
        },
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

  // Manually-built static rules are managed in the Attention Rules panel
  // (dry-run preview, enable gate, version history); plain-English rules stay
  // in Train My Agent.
  const plainEnglishRules = agentRules.filter((r) => r.source !== "manual");

  const styleSummary =
    learnedReplyProfile &&
    typeof learnedReplyProfile.styleSummaryJson === "object" &&
    learnedReplyProfile.styleSummaryJson !== null
      ? (learnedReplyProfile.styleSummaryJson as Record<string, unknown>)
      : null;
  const sourceStats =
    learnedReplyProfile &&
    typeof learnedReplyProfile.sourceStatsJson === "object" &&
    learnedReplyProfile.sourceStatsJson !== null
      ? (learnedReplyProfile.sourceStatsJson as Record<string, unknown>)
      : null;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Assistant Settings</h2>
        <p className="mb-4 text-sm text-slate-500">
          How FlowDesk drafts, reminds, and writes on your behalf. Labeling and routing apply
          automatically; higher-risk actions like drafting, archiving, or sending stay gated by
          your automation level and approvals.
        </p>
        <AssistantSettingsCards
          autopilot={
            autopilotSetting
              ? {
                  automationLevel: autopilotSetting.automationLevel,
                  confidenceThreshold: autopilotSetting.confidenceThreshold,
                }
              : null
          }
          followUp={
            followUpSetting
              ? {
                  enabled: followUpSetting.enabled,
                  staleAfterDays: followUpSetting.staleAfterDays,
                  maxFollowUpsPerConversation: followUpSetting.maxFollowUpsPerConversation,
                }
              : null
          }
          writingStyle={
            learnedReplyProfile
              ? {
                  sampleCount: typeof sourceStats?.sampleCount === "number" ? sourceStats.sampleCount : 0,
                  formalityLevel: typeof styleSummary?.formality === "string" ? styleSummary.formality : null,
                  lastTrainedAt: learnedReplyProfile.lastTrainedAt?.toISOString() ?? null,
                }
              : null
          }
          lastDraftGeneratedAt={latestDraftUsage?.createdAt.toISOString() ?? null}
        />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Personal instructions</h2>
        <p className="mb-4 text-sm text-slate-500">
          Describe rules in plain English and FlowDesk turns them into rules it can act on.
          Training the assistant here never bypasses the automation level and approvals above.
        </p>
        <TrainAgentPanel initialRules={plainEnglishRules} />
      </section>
    </div>
  );
}
