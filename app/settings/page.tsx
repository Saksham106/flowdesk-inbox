import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import DisconnectGmailButton from "@/app/settings/DisconnectGmailButton";
import SyncGmailButton from "@/app/settings/SyncGmailButton";
import DisconnectCalendarButton from "@/app/settings/DisconnectCalendarButton";
import MindBodyConnectForm from "@/app/settings/MindBodyConnectForm";
import DisconnectMindBodyButton from "@/app/settings/DisconnectMindBodyButton";

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

  const [gmailChannels, calendarCredentials, mindBodyCredential] = await Promise.all([
    prisma.channel.findMany({
      where: { tenantId: session.user.tenantId, type: "email" },
      include: { gmailCredential: { select: { createdAt: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.googleCalendarCredential.findMany({
      where: { tenantId: session.user.tenantId },
      orderBy: { createdAt: "asc" },
    }),
    prisma.mindBodyCredential.findUnique({
      where: { tenantId: session.user.tenantId },
    }),
  ]);

  const googleConfigured =
    !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

  const gmailError = searchParams.error
    ? (ERROR_MESSAGES[searchParams.error] ?? "An error occurred. Please try again.")
    : null;

  const calError = searchParams.cal_error
    ? (ERROR_MESSAGES[searchParams.cal_error] ?? "An error occurred. Please try again.")
    : null;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/inbox" className="text-sm text-slate-500 hover:text-slate-700">
              ← Back to inbox
            </Link>
            <h1 className="mt-1 text-xl font-semibold">Settings</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
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
                  <li>Go to <span className="font-mono">console.cloud.google.com</span> → Create a project</li>
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
                      <SyncGmailButton channelId={channel.id} />
                      <DisconnectGmailButton channelId={channel.id} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Google Calendar */}
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
          {/* MindBody */}
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
        </section>
      </main>
    </div>
  );
}
