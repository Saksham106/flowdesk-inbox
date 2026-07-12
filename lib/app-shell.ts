import { prisma } from "@/lib/prisma";
import { salesCrmEnabled, accountModeFor } from "@/lib/tenant-capabilities";

/**
 * Recognizes the transient "database is still booting" errors that Railway's
 * Postgres throws on cold start, so the shell pages can show <WarmingUp/>
 * instead of a hard 500. Shared by /home and /mail (and anywhere else that
 * renders the authenticated shell).
 */
export function isDbStartingError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return (
    msg.includes("database system is starting up") ||
    msg.includes("database system is not yet accepting connections") ||
    msg.includes("Can't reach database server") ||
    msg.includes("ECONNREFUSED") ||
    (err.constructor.name === "PrismaClientInitializationError" && msg.includes("FATAL"))
  );
}

export interface GmailSyncChannel {
  id: string;
  provider: "google" | "microsoft";
  emailAddress: string | null;
  lastSyncedAt: Date | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  watchExpiresAt: Date | null;
  watchLastRenewalAttempt: Date | null;
  watchRenewalError: string | null;
  lastHistoryFallbackAt: Date | null;
}

export interface AppShellContext {
  isBusiness: boolean;
  accountType: string | null;
  /** Raw groupBy rows — /mail forwards these straight to AppListColumn. */
  statusCounts: { status: string; _count: { status: number } }[];
  countByStatus: Record<string, number>;
  totalCount: number;
  needsReplyCount: number;
  pendingApprovals: number;
  gmailSyncChannels: GmailSyncChannel[];
  mailboxAccounts: { id: string; emailAddress: string | null; provider: string }[];
  activeChannelId: string | null;
}

/**
 * Fetches the pieces every authenticated shell page (/home, /mail) computes
 * identically: tenant capabilities, per-status conversation counts, the rail's
 * pending-approvals badge, and the Gmail sync-channel list. All four queries
 * run in a single Promise.all so they resolve concurrently — the efficient
 * fetch pattern both pages now share instead of the previous copy-pasted
 * blocks (and Mail's previously-serialized pendingApprovals await).
 */
export async function getAppShellContext(tenantId: string, requestedChannelId?: string | null): Promise<AppShellContext> {
  const mailboxAccounts = await prisma.channel.findMany({
    where: { tenantId, type: "email", provider: { in: ["google", "microsoft"] } },
    select: { id: true, emailAddress: true, provider: true },
    orderBy: { createdAt: "asc" },
  });
  const activeChannelId = mailboxAccounts.some((account) => account.id === requestedChannelId)
    ? requestedChannelId ?? null
    : null;
  const conversationScope = { tenantId, ...(activeChannelId ? { channelId: activeChannelId } : {}) };

  const [tenant, statusCounts, gmailChannels, outlookChannels, pendingApprovals] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { salesCrmEnabled: true },
    }),
    prisma.conversation.groupBy({
      by: ["status"],
      where: conversationScope,
      _count: { status: true },
    }),
    prisma.channel.findMany({
      where: { tenantId, type: "email", provider: "google" },
      select: {
        id: true,
        emailAddress: true,
        gmailCredential: {
          select: {
            lastSyncedAt: true,
            lastSyncStatus: true,
            lastSyncError: true,
            watchExpiresAt: true,
            watchLastRenewalAttempt: true,
            watchRenewalError: true,
            lastHistoryFallbackAt: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.channel.findMany({
      where: { tenantId, type: "email", provider: "microsoft" },
      select: {
        id: true,
        emailAddress: true,
        outlookCredential: {
          select: {
            lastSyncedAt: true,
            lastSyncError: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.approvalRequest.count({
      where: {
        tenantId,
        status: "pending",
        ...(activeChannelId ? { conversation: { channelId: activeChannelId } } : {}),
      },
    }),
  ]);

  const isBusiness = salesCrmEnabled(tenant);
  const accountType = accountModeFor(tenant);

  const countByStatus = Object.fromEntries(
    statusCounts.map((r) => [r.status, r._count.status])
  ) as Record<string, number>;
  const totalCount = statusCounts.reduce((sum, r) => sum + r._count.status, 0);
  const needsReplyCount = countByStatus["needs_reply"] ?? 0;

  // Despite the historical name, this list covers every connected mailbox —
  // the shared sync control routes each entry to its provider's sync API.
  const gmailSyncChannels: GmailSyncChannel[] = [
    ...gmailChannels
      .filter((channel) => channel.gmailCredential)
      .map((channel): GmailSyncChannel => ({
        id: channel.id,
        provider: "google",
        emailAddress: channel.emailAddress,
        lastSyncedAt: channel.gmailCredential?.lastSyncedAt ?? null,
        lastSyncStatus: channel.gmailCredential?.lastSyncStatus ?? null,
        lastSyncError: channel.gmailCredential?.lastSyncError ?? null,
        watchExpiresAt: channel.gmailCredential?.watchExpiresAt ?? null,
        watchLastRenewalAttempt: channel.gmailCredential?.watchLastRenewalAttempt ?? null,
        watchRenewalError: channel.gmailCredential?.watchRenewalError ?? null,
        lastHistoryFallbackAt: channel.gmailCredential?.lastHistoryFallbackAt ?? null,
      })),
    ...outlookChannels
      .filter((channel) => channel.outlookCredential)
      .map((channel): GmailSyncChannel => ({
        id: channel.id,
        provider: "microsoft",
        emailAddress: channel.emailAddress,
        lastSyncedAt: channel.outlookCredential?.lastSyncedAt ?? null,
        lastSyncStatus: null,
        lastSyncError: channel.outlookCredential?.lastSyncError ?? null,
        // Graph subscription health is tracked on the connect page; the
        // watch fields are Gmail-only and stay null so the push-health
        // warnings in the sync control never fire for Outlook entries.
        watchExpiresAt: null,
        watchLastRenewalAttempt: null,
        watchRenewalError: null,
        lastHistoryFallbackAt: null,
      })),
  ];

  return {
    isBusiness,
    accountType,
    statusCounts,
    countByStatus,
    totalCount,
    needsReplyCount,
    pendingApprovals,
    gmailSyncChannels,
    mailboxAccounts,
    activeChannelId,
  };
}
