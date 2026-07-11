import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import DisconnectGmailButton from "@/app/settings/DisconnectGmailButton";
import SyncGmailButton from "@/app/settings/SyncGmailButton";
import DisconnectOutlookButton from "@/app/settings/DisconnectOutlookButton";
import SyncOutlookButton from "@/app/settings/SyncOutlookButton";
import GmailOperatorHealthPanel from "@/app/settings/GmailOperatorHealthPanel";
import FixGmailLabelsButton from "@/app/settings/FixGmailLabelsButton";
import { summarizeGmailOperatorHealth } from "@/lib/gmail-operator-health";
import { summarizeOutlookOperatorHealth } from "@/lib/outlook-operator-health";
import { salesCrmEnabled } from "@/lib/tenant-capabilities";

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

export default async function ConnectSettingsPage({ searchParams }: Props) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) redirect("/login");

  const recentPushFailureCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    gmailChannels,
    outlookChannels,
    tenant,
    pendingWritebacks,
    processingWritebacks,
    failedWritebacks,
    oldestPendingWriteback,
    pendingAgentJobs,
    runningAgentJobs,
    failedAgentJobs,
    oldestPendingAgentJob,
    recentPushFailures,
    outlookWritebackPending,
    outlookWritebackFailed,
    oldestPendingOutlookWriteback,
    outlookSyncEventsFailed,
  ] = await Promise.all([
    prisma.channel.findMany({
      where: { tenantId: session.user.tenantId, type: "email" },
      include: {
        gmailCredential: {
          select: {
            createdAt: true,
            lastSyncedAt: true,
            lastSyncError: true,
            watchExpiresAt: true,
            watchLastRenewalAttempt: true,
            watchRenewalError: true,
            lastSyncMode: true,
            lastSyncStatus: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.channel.findMany({
      where: { tenantId: session.user.tenantId, provider: "microsoft" },
      include: {
        outlookCredential: {
          select: {
            createdAt: true,
            lastSyncedAt: true,
            lastSyncStatus: true,
            lastSyncError: true,
            subscriptionExpiresAt: true,
            subscriptionError: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.tenant.findUnique({
      where: { id: session.user.tenantId },
      select: { salesCrmEnabled: true },
    }),
    prisma.emailWritebackQueue.count({
      where: { tenantId: session.user.tenantId, status: "pending" },
    }),
    prisma.emailWritebackQueue.count({
      where: { tenantId: session.user.tenantId, status: "processing" },
    }),
    prisma.emailWritebackQueue.count({
      where: { tenantId: session.user.tenantId, status: "failed" },
    }),
    prisma.emailWritebackQueue.findFirst({
      where: { tenantId: session.user.tenantId, status: "pending" },
      orderBy: { nextAttemptAt: "asc" },
      select: { nextAttemptAt: true },
    }),
    prisma.agentJob.count({
      where: { tenantId: session.user.tenantId, status: "pending" },
    }),
    prisma.agentJob.count({
      where: { tenantId: session.user.tenantId, status: "running" },
    }),
    prisma.agentJob.count({
      where: { tenantId: session.user.tenantId, status: "failed" },
    }),
    prisma.agentJob.findFirst({
      where: { tenantId: session.user.tenantId, status: "pending" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.gmailPushEvent.count({
      where: {
        tenantId: session.user.tenantId,
        status: "failed",
        createdAt: { gte: recentPushFailureCutoff },
      },
    }),
    prisma.emailWritebackQueue.count({
      where: {
        tenantId: session.user.tenantId,
        status: "pending",
        channel: { provider: "microsoft" },
      },
    }),
    prisma.emailWritebackQueue.count({
      where: {
        tenantId: session.user.tenantId,
        status: "failed",
        channel: { provider: "microsoft" },
      },
    }),
    prisma.emailWritebackQueue.findFirst({
      where: {
        tenantId: session.user.tenantId,
        status: "pending",
        channel: { provider: "microsoft" },
      },
      orderBy: { nextAttemptAt: "asc" },
      select: { nextAttemptAt: true },
    }),
    prisma.outlookSyncEvent.count({
      where: {
        tenantId: session.user.tenantId,
        status: "failed",
        createdAt: { gte: recentPushFailureCutoff },
      },
    }),
  ]);

  const isPersonal = !salesCrmEnabled(tenant);

  const gmailOperatorHealth = summarizeGmailOperatorHealth({
    channels: gmailChannels
      .filter((channel) => channel.provider === "google")
      .map((channel) => ({
        emailAddress: channel.emailAddress,
        lastSyncedAt: channel.gmailCredential?.lastSyncedAt ?? null,
        lastSyncStatus: channel.gmailCredential?.lastSyncStatus ?? null,
        lastSyncError: channel.gmailCredential?.lastSyncError ?? null,
        watchExpiresAt: channel.gmailCredential?.watchExpiresAt ?? null,
        watchRenewalError: channel.gmailCredential?.watchRenewalError ?? null,
      })),
    writeback: {
      pending: pendingWritebacks,
      processing: processingWritebacks,
      failed: failedWritebacks,
      oldestPendingAt: oldestPendingWriteback?.nextAttemptAt ?? null,
    },
    agentJobs: {
      pending: pendingAgentJobs,
      running: runningAgentJobs,
      failed: failedAgentJobs,
      oldestPendingAt: oldestPendingAgentJob?.createdAt ?? null,
    },
    recentPushFailures,
  });

  // Assembled only meaningfully when microsoft channels exist; summarizer
  // returns a benign "not connected" summary otherwise, and the panel below
  // only renders when outlookChannels.length > 0.
  const outlookOperatorHealth = summarizeOutlookOperatorHealth({
    now: new Date(),
    channels: outlookChannels.map((channel) => ({
      id: channel.id,
      emailAddress: channel.emailAddress,
      lastSyncedAt: channel.outlookCredential?.lastSyncedAt ?? null,
      lastSyncStatus: channel.outlookCredential?.lastSyncStatus ?? null,
      lastSyncError: channel.outlookCredential?.lastSyncError ?? null,
      subscriptionExpiresAt: channel.outlookCredential?.subscriptionExpiresAt ?? null,
      subscriptionError: channel.outlookCredential?.subscriptionError ?? null,
    })),
    writebackPending: outlookWritebackPending,
    writebackFailed: outlookWritebackFailed,
    oldestPendingWritebackAt: oldestPendingOutlookWriteback?.nextAttemptAt ?? null,
    syncEventsFailed: outlookSyncEventsFailed,
  });

  const googleConfigured = !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
  const microsoftConfigured = !!process.env.MICROSOFT_CLIENT_ID && !!process.env.MICROSOFT_CLIENT_SECRET;

  const gmailError = searchParams.error
    ? (ERROR_MESSAGES[searchParams.error] ?? "An error occurred. Please try again.")
    : null;

  const calError = searchParams.cal_error
    ? (ERROR_MESSAGES[searchParams.cal_error] ?? "An error occurred. Please try again.")
    : null;

  return (
    <>
      {/* Success / error banners */}
      <div className="space-y-3 empty:hidden">
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
      </div>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="font-semibold">Connectors</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Connect external accounts so FlowDesk can read and reply to messages on your behalf.{" "}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-slate-700">
              How your data is handled
            </Link>
            .
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
              <GmailOperatorHealthPanel summary={gmailOperatorHealth} />
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

        {/* Outlook / Microsoft 365 — deferred out of the MVP default path; still
            shown when already connected so existing channels stay manageable */}
        {(!isPersonal || outlookChannels.length > 0) && (
          <div className="px-6 py-5">
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
                <GmailOperatorHealthPanel
                  summary={outlookOperatorHealth}
                  title="Outlook operator health"
                  description="Tracks sync, subscription, and writeback."
                />
                <FixGmailLabelsButton provider="outlook" providerLabel="Outlook" />
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
        )}
      </section>
    </>
  );
}
