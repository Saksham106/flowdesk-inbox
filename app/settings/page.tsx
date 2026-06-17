import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import DisconnectGmailButton from "@/app/settings/DisconnectGmailButton";
import SyncGmailButton from "@/app/settings/SyncGmailButton";
import DisconnectOutlookButton from "@/app/settings/DisconnectOutlookButton";
import SyncOutlookButton from "@/app/settings/SyncOutlookButton";
import DisconnectCalendarButton from "@/app/settings/DisconnectCalendarButton";
import MindBodyConnectForm from "@/app/settings/MindBodyConnectForm";
import DisconnectMindBodyButton from "@/app/settings/DisconnectMindBodyButton";
import KnowledgeDocumentList from "@/app/settings/KnowledgeDocumentList";
import BusinessProfileForm from "@/app/settings/BusinessProfileForm";
import FollowUpSettingsForm from "@/app/settings/FollowUpSettingsForm";
import AutopilotSettingsForm from "@/app/settings/AutopilotSettingsForm";
import PersonalStylePanel from "@/app/settings/PersonalStylePanel"
import ConciergeTemplateSeedButton from "./ConciergeTemplateSeedButton";
import VipContactsForm from "@/app/settings/VipContactsForm"
import SenderRulesPanel from "@/app/settings/SenderRulesPanel";
import AiBudgetPanel from "@/app/settings/AiBudgetPanel";
import { getAiBudgetStatus } from "@/lib/ai/budget";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: {
    connected?: string;
    error?: string;
    cal_connected?: string;
    cal_error?: string;
  };
}

const ERROR_MESSAGES: Record<string, string> = {
  google_denied: "Google sign-in was cancelled.",
  invalid_state: "The authentication request expired. Please try again.",
  token_exchange_failed: "Could not complete Google sign-in. Please try again.",
  missing_tokens: "Google did not return the required permissions. Make sure to grant all requested scopes.",
  userinfo_failed: "Could not retrieve account info.",
  no_email: "No email address returned from Google.",
  invalid_callback: "Invalid callback. Please try connecting again.",
};

export default async function SettingsPage({ searchParams }: Props) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) redirect("/login");

  const [
    gmailChannels,
    outlookChannels,
    calendarCredentials,
    mindBodyCredential,
    knowledgeDocuments,
    businessProfile,
    followUpSetting,
    autopilotSetting,
    tenant,
    learnedReplyProfile,
    latestLearningUsage,
    vipContacts,
  ] = await Promise.all([
    prisma.channel.findMany({
      where: { tenantId: session.user.tenantId, type: "email" },
      include: { gmailCredential: { select: { createdAt: true, lastSyncedAt: true, lastSyncError: true, watchExpiresAt: true, lastSyncMode: true, lastSyncStatus: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.channel.findMany({
      where: { tenantId: session.user.tenantId, provider: "microsoft" },
      include: { outlookCredential: { select: { createdAt: true, lastSyncedAt: true, lastSyncError: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.googleCalendarCredential.findMany({
      where: { tenantId: session.user.tenantId },
      orderBy: { createdAt: "asc" },
    }),
    prisma.mindBodyCredential.findUnique({
      where: { tenantId: session.user.tenantId },
    }),
    prisma.knowledgeDocument.findMany({
      where: { tenantId: session.user.tenantId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.businessProfile.findUnique({
      where: { tenantId: session.user.tenantId },
    }),
    prisma.followUpSetting.findUnique({
      where: { tenantId: session.user.tenantId },
    }),
    prisma.autopilotSetting.findUnique({
      where: { tenantId: session.user.tenantId },
    }),
    prisma.tenant.findUnique({
      where: { id: session.user.tenantId },
      select: { accountType: true },
    }),
    prisma.learnedReplyProfile.findFirst({
      where: { tenantId: session.user.tenantId },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.aiUsageEvent.findFirst({
      where: { tenantId: session.user.tenantId, feature: "reply_learning.train" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.vipContact.findMany({
      where: { tenantId: session.user.tenantId },
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true, label: true },
    }),
  ]);

  const [senderRules, aiBudgetStatus] = await Promise.all([
    prisma.senderRule.findMany({
      where: { tenantId: session.user.tenantId, status: { in: ["suggested", "active"] } },
      orderBy: { createdAt: "desc" },
    }),
    getAiBudgetStatus(session.user.tenantId),
  ]);

  const isPersonal = tenant?.accountType === "personal";

  const templateCount = !isPersonal
    ? await prisma.knowledgeDocument.count({ where: { tenantId: session.user.tenantId, sourceType: "concierge_template" } })
    : 0

  const googleConfigured =
    !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

  const microsoftConfigured =
    !!process.env.MICROSOFT_CLIENT_ID && !!process.env.MICROSOFT_CLIENT_SECRET;

  const gmailError = searchParams.error
    ? (ERROR_MESSAGES[searchParams.error] ?? "An error occurred. Please try again.")
    : null;

  const calError = searchParams.cal_error
    ? (ERROR_MESSAGES[searchParams.cal_error] ?? "An error occurred. Please try again.")
    : null;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 sm:px-6 py-4">
          <div>
            <Link href="/inbox" className="text-sm text-slate-500 hover:text-slate-700">
              &larr; Back to inbox
            </Link>
            <h1 className="mt-1 text-xl font-semibold">Settings</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 sm:px-6 py-8">
        {/* Success / error banners */}
        {gmailError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Gmail: {gmailError}
          </div>
        )}
        {searchParams.connected && (
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            <span className="font-medium">{decodeURIComponent(searchParams.connected)}</span> connected
            — recent threads imported into your inbox.
          </div>
        )}
        {calError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Google Calendar: {calError}
          </div>
        )}
        {searchParams.cal_connected && (
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            <span className="font-medium">{decodeURIComponent(searchParams.cal_connected)}</span> calendar
            connected successfully.
          </div>
        )}

        {/* Connectors */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4">
            <h2 className="font-semibold">Connectors</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Connect external accounts so FlowDesk can read and reply to messages on your behalf.
            </p>
          </div>

          {/* Gmail */}
          <div className="border-b border-slate-100 px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                    <path
                      d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.908 1.528-1.147C21.69 2.28 24 3.434 24 5.457z"
                      fill="#EA4335"
                    />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium">Gmail</p>
                  <p className="text-xs text-slate-500">
                    Read your inbox and reply to emails directly from FlowDesk.
                  </p>
                </div>
              </div>

              {!googleConfigured ? (
                <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                  Not configured
                </span>
              ) : (
                <a
                  href="/api/connectors/gmail/connect"
                  className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
                >
                  + Connect
                </a>
              )}
            </div>

            {!googleConfigured && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <p className="font-medium">Setup required</p>
                <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-amber-700">
                  <li>Go to <span className="font-mono">console.cloud.google.com</span> &rarr; Create a project</li>
                  <li>Enable the <span className="font-medium">Gmail API</span> and <span className="font-medium">Google Calendar API</span></li>
                  <li>Create <span className="font-medium">OAuth 2.0 credentials</span> (Web application)</li>
                  <li>Add redirect URIs for both Gmail and Calendar callbacks</li>
                  <li>Set <span className="font-mono">GOOGLE_CLIENT_ID</span> and <span className="font-mono">GOOGLE_CLIENT_SECRET</span> in your <span className="font-mono">.env</span></li>
                </ol>
              </div>
            )}

            {gmailChannels.length > 0 && (
              <div className="mt-4 space-y-3">
                {gmailChannels.map((channel) => (
                  <div
                    key={channel.id}
                    className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{channel.emailAddress}</p>
                      <p className="text-xs text-slate-500">
                        Connected {channel.gmailCredential?.createdAt.toLocaleDateString()}
                      </p>
                    </div>
                    <div className="ml-4 flex shrink-0 items-center gap-2">
                      <SyncGmailButton
                        channelId={channel.id}
                        lastSyncedAt={channel.gmailCredential?.lastSyncedAt ?? null}
                        lastSyncMode={channel.gmailCredential?.lastSyncMode ?? null}
                        lastSyncStatus={channel.gmailCredential?.lastSyncStatus ?? null}
                        lastSyncError={channel.gmailCredential?.lastSyncError ?? null}
                      />
                      <DisconnectGmailButton channelId={channel.id} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Outlook / Microsoft 365 */}
          <div className={`border-b border-slate-100 px-6 py-5`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                    <rect x="1" y="1" width="10" height="10" fill="#F25022"/>
                    <rect x="13" y="1" width="10" height="10" fill="#7FBA00"/>
                    <rect x="1" y="13" width="10" height="10" fill="#00A4EF"/>
                    <rect x="13" y="13" width="10" height="10" fill="#FFB900"/>
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium">Outlook / Microsoft 365</p>
                  <p className="text-xs text-slate-500">
                    Read your inbox and reply to emails directly from FlowDesk.
                  </p>
                </div>
              </div>

              {!microsoftConfigured ? (
                <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                  Not configured
                </span>
              ) : (
                <a
                  href="/api/connectors/outlook/connect"
                  className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
                >
                  + Connect
                </a>
              )}
            </div>

            {!microsoftConfigured && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <p className="font-medium">Setup required</p>
                <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-amber-700">
                  <li>Go to <span className="font-mono">portal.azure.com</span> &rarr; Azure Active Directory &rarr; App registrations</li>
                  <li>Create a new registration with &ldquo;personal + work accounts&rdquo; support</li>
                  <li>Add redirect URI: <span className="font-mono">{"{NEXTAUTH_URL}"}/api/connectors/outlook/callback</span></li>
                  <li>Add API permissions: <span className="font-medium">Mail.Read, Mail.Send, Mail.ReadWrite, User.Read, offline_access</span></li>
                  <li>Set <span className="font-mono">MICROSOFT_CLIENT_ID</span> and <span className="font-mono">MICROSOFT_CLIENT_SECRET</span> in your <span className="font-mono">.env</span></li>
                </ol>
              </div>
            )}

            {outlookChannels.length > 0 && (
              <div className="mt-4 space-y-3">
                {outlookChannels.map((channel) => (
                  <div
                    key={channel.id}
                    className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{channel.emailAddress}</p>
                      <p className="text-xs text-slate-500">
                        Connected {channel.outlookCredential?.createdAt.toLocaleDateString()}
                      </p>
                    </div>
                    <div className="ml-4 flex shrink-0 items-center gap-2">
                      <SyncOutlookButton
                        channelId={channel.id}
                        lastSyncedAt={channel.outlookCredential?.lastSyncedAt ?? null}
                        lastSyncError={channel.outlookCredential?.lastSyncError ?? null}
                      />
                      <DisconnectOutlookButton channelId={channel.id} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Google Calendar — business only */}
          {!isPersonal && (
            <div className="border-b border-slate-100 px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                      <path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V9h14v11zM5 7V6h14v1H5z" fill="#4285F4" />
                      <path d="M7 11h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2zM7 15h2v2H7zm4 0h2v2h-2z" fill="#4285F4" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Google Calendar</p>
                    <p className="text-xs text-slate-500">
                      Read and create calendar events, check availability, and book appointments.
                    </p>
                  </div>
                </div>

                {!googleConfigured ? (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                    Not configured
                  </span>
                ) : (
                  <a
                    href="/api/connectors/google-calendar/connect"
                    className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
                  >
                    + Connect
                  </a>
                )}
              </div>

              {calendarCredentials.length > 0 && (
                <div className="mt-4 space-y-3">
                  {calendarCredentials.map((cred) => (
                    <div
                      key={cred.id}
                      className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{cred.email}</p>
                        <p className="text-xs text-slate-500">
                          Connected {cred.createdAt.toLocaleDateString()}
                        </p>
                      </div>
                      <div className="ml-4 shrink-0">
                        <DisconnectCalendarButton email={cred.email} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* MindBody — business only */}
          {!isPersonal && (
            <div className="px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" fill="#0077CC" />
                      <path d="M7 8h2.5l2.5 5 2.5-5H17v8h-2v-5l-2 4h-1l-2-4v5H7V8z" fill="white" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium">MindBody</p>
                    <p className="text-xs text-slate-500">
                      Look up clients, view appointments, and book sessions from your MindBody site.
                    </p>
                  </div>
                </div>

                {!mindBodyCredential && (
                  !process.env.MINDBODY_API_KEY ? (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                      Not configured
                    </span>
                  ) : (
                    <MindBodyConnectForm />
                  )
                )}

                {mindBodyCredential && (
                  <DisconnectMindBodyButton />
                )}
              </div>

              {mindBodyCredential && (
                <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="text-sm font-medium">Site ID: {mindBodyCredential.siteId}</p>
                  <p className="text-xs text-slate-500">
                    Connected {mindBodyCredential.createdAt.toLocaleDateString()}
                  </p>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Business Profile — business only */}
        {!isPersonal && (
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-6 py-4">
              <h2 className="font-semibold">Business Profile</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                Configure the business facts, tone, booking rules, and escalation policy the AI will use.
              </p>
            </div>
            <div className="px-6 py-5">
              <BusinessProfileForm
                initial={businessProfile}
                calendarEmails={calendarCredentials.map((c) => c.email)}
              />
            </div>
          </section>
        )}

        {/* Knowledge Base — business only */}
        {!isPersonal && (
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-6 py-4">
              <h2 className="font-semibold">Knowledge Base</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                Add FAQs, service descriptions, policies, and other information the AI will use when drafting replies.
              </p>
            </div>
            <div className="px-6 py-5">
              <KnowledgeDocumentList initialDocuments={knowledgeDocuments} />
            </div>
          </section>
        )}

        {/* Concierge Templates — business only */}
        {!isPersonal && (
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold">Concierge Templates</h2>
            <div className="mt-4">
              <ConciergeTemplateSeedButton alreadySeeded={templateCount > 0} />
            </div>
          </section>
        )}

        {/* Reply Learning */}
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
            <PersonalStylePanel
              initial={toLearnedPanelSnapshot(learnedReplyProfile, latestLearningUsage)}
            />
          </div>
        </section>

        {/* Follow-Up Automation */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4">
            <h2 className="font-semibold">Follow-Up Automation</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {isPersonal ? "Surface quiet conversations in your " : "Surface quiet leads in your "}
              <a href="/digest" className="underline hover:text-slate-700">
                daily digest
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

        {/* Attention Rules */}
        {senderRules.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-6 py-4">
              <h2 className="font-semibold">Attention Rules</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                FlowDesk noticed you consistently change certain senders&apos; attention tag. Accept a rule to apply it automatically.
              </p>
            </div>
            <div className="px-6 py-5">
              <SenderRulesPanel initialRules={senderRules} />
            </div>
          </section>
        )}

        {/* Autopilot / Auto-Send */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4">
            <h2 className="font-semibold">{isPersonal ? "Auto-Send" : "Autopilot"}</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {isPersonal
                ? "Allow FlowDesk to send replies automatically when it is highly confident the draft matches your style."
                : "Allow the AI to send replies automatically for low-risk, high-confidence categories. Requires trust to be earned first."}
            </p>
          </div>
          <div className="px-6 py-5">
            <AutopilotSettingsForm
              requiresLearnedProfile={isPersonal}
              hasLearnedProfile={!!learnedReplyProfile}
              initial={
                autopilotSetting
                  ? {
                      enabled: autopilotSetting.enabled,
                      confidenceThreshold: autopilotSetting.confidenceThreshold,
                      allowedIntents: Array.isArray(autopilotSetting.allowedIntentsJson)
                        ? (autopilotSetting.allowedIntentsJson as string[])
                        : [],
                      maxAutoSendsPerDay: autopilotSetting.maxAutoSendsPerDay,
                      disableAfterFailures: autopilotSetting.disableAfterFailures,
                      currentFailures: autopilotSetting.currentFailures,
                      disabledAt: autopilotSetting.disabledAt?.toISOString() ?? null,
                      categoryThresholds:
                        typeof autopilotSetting.categoryThresholdsJson === "object" &&
                        autopilotSetting.categoryThresholdsJson !== null
                          ? (autopilotSetting.categoryThresholdsJson as Record<string, number>)
                          : {},
                    }
                  : null
              }
            />
          </div>
        </section>

        {/* VIP Contacts */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-5">
            <div className="mt-8">
              <VipContactsForm initialVips={vipContacts} />
            </div>
          </div>
        </section>

        {/* AI Spend Budget */}
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
      </main>
    </div>
  );
}

function toLearnedPanelSnapshot(
  profile: {
    styleSummaryJson: unknown
    exampleSnippetsJson: unknown
    sourceStatsJson: unknown
    lastTrainedAt: Date | null
  } | null,
  usage: {
    estimatedInputTokens: number
    estimatedOutputTokens: number
    status: string
    createdAt: Date
  } | null
) {
  if (!profile) return null

  const style =
    typeof profile.styleSummaryJson === "object" && profile.styleSummaryJson !== null
      ? (profile.styleSummaryJson as Record<string, unknown>)
      : {}
  const sourceStats =
    typeof profile.sourceStatsJson === "object" && profile.sourceStatsJson !== null
      ? (profile.sourceStatsJson as Record<string, unknown>)
      : {}

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
    lastTrainingTokens: usage
      ? usage.estimatedInputTokens + usage.estimatedOutputTokens
      : null,
    lastTrainingStatus: usage?.status ?? null,
    lastTrainingAt: usage?.createdAt.toISOString() ?? null,
  }
}
