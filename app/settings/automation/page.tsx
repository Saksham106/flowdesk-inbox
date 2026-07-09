import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { salesCrmEnabled } from "@/lib/tenant-capabilities";
import FollowUpSettingsForm from "@/app/settings/FollowUpSettingsForm";
import AutopilotSettingsForm from "@/app/settings/AutopilotSettingsForm";

export const dynamic = "force-dynamic";

export default async function AutomationSettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) redirect("/login");

  const [followUpSetting, autopilotSetting, tenant, learnedReplyProfile] = await Promise.all([
    prisma.followUpSetting.findUnique({
      where: { tenantId: session.user.tenantId },
    }),
    prisma.autopilotSetting.findUnique({
      where: { tenantId: session.user.tenantId },
    }),
    prisma.tenant.findUnique({
      where: { id: session.user.tenantId },
      select: { salesCrmEnabled: true },
    }),
    prisma.learnedReplyProfile.findFirst({
      where: { tenantId: session.user.tenantId },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const isPersonal = !salesCrmEnabled(tenant);

  return (
    <>
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="font-semibold">Follow-Up Automation</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {isPersonal ? "Surface quiet conversations in your " : "Surface quiet leads in your "}
            <a href="/home" className="underline hover:text-slate-700">
              control room
            </a>{" "}
            {isPersonal
              ? "so important replies do not slip."
              : "so you never let a hot lead go cold."}
          </p>
        </div>
        <div className="px-6 py-5">
          <FollowUpSettingsForm
            initial={
              followUpSetting
                ? {
                    enabled: followUpSetting.enabled,
                    staleAfterDays: followUpSetting.staleAfterDays,
                    maxFollowUpsPerConversation: followUpSetting.maxFollowUpsPerConversation,
                  }
                : null
            }
          />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="font-semibold">Automation Level</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Choose how much FlowDesk is allowed to do on its own. Each level includes
            everything below it; you can move up or down at any time.
          </p>
        </div>
        <div className="px-6 py-5">
          <AutopilotSettingsForm
            requiresLearnedProfile={isPersonal}
            hasLearnedProfile={!!learnedReplyProfile}
            initial={
              autopilotSetting
                ? {
                    automationLevel: autopilotSetting.automationLevel,
                    enabled: autopilotSetting.enabled,
                    confidenceThreshold: autopilotSetting.confidenceThreshold,
                    maxAutoSendsPerDay: autopilotSetting.maxAutoSendsPerDay,
                    disableAfterFailures: autopilotSetting.disableAfterFailures,
                    currentFailures: autopilotSetting.currentFailures,
                    disabledAt: autopilotSetting.disabledAt?.toISOString() ?? null,
                    categoryThresholds:
                      typeof autopilotSetting.categoryThresholdsJson === "object" &&
                      autopilotSetting.categoryThresholdsJson !== null
                        ? (autopilotSetting.categoryThresholdsJson as Record<string, number | { action: string; threshold?: number }>)
                        : {},
                  }
                : null
            }
          />
        </div>
      </section>
    </>
  );
}
