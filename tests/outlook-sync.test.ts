import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  channelFindUnique: vi.fn(),
  credentialFindUnique: vi.fn(),
  credentialUpdateMany: vi.fn(),
  contactUpsert: vi.fn(),
  conversationUpsert: vi.fn(),
  conversationUpdate: vi.fn(),
  messageUpsert: vi.fn(),
  messageFindUnique: vi.fn(),
  messageDelete: vi.fn(),
  messageFindFirst: vi.fn(),
  messageCount: vi.fn(),
  getToken: vi.fn(),
  graphGet: vi.fn(),
  encrypt: vi.fn((value: string) => `enc:${value}`),
  decrypt: vi.fn((value: string) => value.replace(/^enc:/, "")),
  syncWorkItems: vi.fn(),
  applyCategoryFeedback: vi.fn(),
  clearLabelOverride: vi.fn(),
  writebackFindUnique: vi.fn(),
  applyCore: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channel: { findUnique: mocks.channelFindUnique },
    outlookCredential: {
      findUnique: mocks.credentialFindUnique,
      updateMany: mocks.credentialUpdateMany,
    },
    contact: { upsert: mocks.contactUpsert },
    conversation: {
      upsert: mocks.conversationUpsert,
      update: mocks.conversationUpdate,
    },
    message: {
      upsert: mocks.messageUpsert,
      findUnique: mocks.messageFindUnique,
      delete: mocks.messageDelete,
      findFirst: mocks.messageFindFirst,
      count: mocks.messageCount,
    },
    emailWritebackQueue: { findUnique: mocks.writebackFindUnique },
  },
}));

vi.mock("@/lib/microsoft", () => {
  class MicrosoftGraphError extends Error {
    constructor(public readonly status: number) {
      super(`Microsoft Graph request failed (${status})`)
    }
  }
  return {
    MicrosoftGraphError,
    getOutlookAccessToken: mocks.getToken,
    graphGet: mocks.graphGet,
  }
});

vi.mock("@/lib/crypto", () => ({
  encryptString: mocks.encrypt,
  decryptString: mocks.decrypt,
}));

vi.mock("@/lib/agent/work-item-sync", () => ({
  syncConversationWorkItems: mocks.syncWorkItems,
}));

vi.mock("@/lib/agent/outlook-category-feedback", () => ({
  applyOutlookCategoryFeedback: mocks.applyCategoryFeedback,
}));

vi.mock("@/lib/agent/gmail-label-feedback", () => ({
  clearGmailLabelOverride: mocks.clearLabelOverride,
}));

// Mocked so the pre-run-snapshot integration tests can delegate the feedback
// mock to the REAL applyOutlookCategoryFeedback and observe which corrections
// it would record without touching further prisma models.
vi.mock("@/lib/agent/label-feedback-core", () => ({
  applyLabelFeedbackCore: mocks.applyCore,
}));

import { runOutlookDeltaSync } from "@/lib/outlook-sync";

function message(
  id: string,
  receivedDateTime = "2026-06-24T12:00:00.000Z",
  overrides: { isRead?: boolean; categories?: string[] } = {}
) {
  return {
    id,
    conversationId: "graph-conversation-1",
    subject: "Hello",
    from: { emailAddress: { address: "sender@example.com", name: "Sender" } },
    toRecipients: [{ emailAddress: { address: "owner@example.com", name: "Owner" } }],
    body: { content: "<p>Hello there</p>", contentType: "html" },
    receivedDateTime,
    internetMessageId: `<${id}@example.com>`,
    isRead: overrides.isRead ?? false,
    ...(overrides.categories ? { categories: overrides.categories } : {}),
  };
}

describe("runOutlookDeltaSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.channelFindUnique.mockResolvedValue({
      id: "channel-1",
      tenantId: "tenant-1",
      provider: "microsoft",
      emailAddress: "owner@example.com",
    });
    mocks.credentialFindUnique.mockResolvedValue({
      channelId: "channel-1",
      deltaLinkEncrypted: null,
    });
    mocks.credentialUpdateMany.mockResolvedValue({ count: 1 });
    mocks.getToken.mockResolvedValue("access-token");
    mocks.contactUpsert.mockResolvedValue({ id: "contact-1" });
    mocks.conversationUpsert.mockResolvedValue({ id: "conversation-1" });
    mocks.messageUpsert.mockResolvedValue({ id: "message-1" });
    mocks.messageFindUnique.mockResolvedValue(null);
    mocks.messageCount.mockResolvedValue(0);
    mocks.syncWorkItems.mockResolvedValue(undefined);
    mocks.applyCategoryFeedback.mockResolvedValue({ applied: false });
    mocks.clearLabelOverride.mockResolvedValue(true);
    mocks.writebackFindUnique.mockResolvedValue(null);
    mocks.applyCore.mockResolvedValue({ applied: true, kind: "addition" });
  });

  it("processes nextLink pages and persists the final encrypted deltaLink", async () => {
    mocks.graphGet
      .mockResolvedValueOnce({
        value: [message("message-1")],
        "@odata.nextLink": "https://graph.microsoft.com/next-page-secret",
      })
      .mockResolvedValueOnce({
        value: [message("message-2", "2026-06-24T13:00:00.000Z")],
        "@odata.deltaLink": "https://graph.microsoft.com/final-delta-secret",
      });

    const result = await runOutlookDeltaSync({
      channelId: "channel-1",
      tenantId: "tenant-1",
      requestedMode: "manual",
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      synced: 2,
      pages: 2,
      hasMore: false,
      mode: "manual_delta",
    }));
    expect(mocks.graphGet).toHaveBeenNthCalledWith(
      2,
      "https://graph.microsoft.com/next-page-secret",
      "access-token",
      expect.any(Object)
    );
    expect(mocks.encrypt).toHaveBeenCalledWith("https://graph.microsoft.com/final-delta-secret");
    expect(mocks.credentialUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ channelId: "channel-1", syncLeaseId: expect.any(String) }),
      data: expect.objectContaining({ deltaLinkEncrypted: "enc:https://graph.microsoft.com/final-delta-secret" }),
    }));
    expect(mocks.messageUpsert).toHaveBeenCalledTimes(2);
    expect(mocks.syncWorkItems).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
    });
  });

  it("persists nextLink and stops at the configured page bound", async () => {
    mocks.graphGet.mockResolvedValueOnce({
      value: [message("message-1")],
      "@odata.nextLink": "https://graph.microsoft.com/continue-later-secret",
    });

    const result = await runOutlookDeltaSync({
      channelId: "channel-1",
      tenantId: "tenant-1",
      requestedMode: "cron",
      maxPages: 1,
    });

    expect(result).toEqual(expect.objectContaining({ pages: 1, hasMore: true }));
    expect(mocks.encrypt).toHaveBeenCalledWith("https://graph.microsoft.com/continue-later-secret");
    expect(mocks.graphGet).toHaveBeenCalledTimes(1);
    const release = mocks.credentialUpdateMany.mock.calls.at(-1)?.[0]
    expect(release.data.lastSyncStatus).toBe("partial")
    expect(release.data.lastSyncedAt).toBeUndefined()
  });

  it("clears an expired delta cursor so a later bounded run can restart", async () => {
    const { MicrosoftGraphError } = await import("@/lib/microsoft")
    mocks.credentialFindUnique.mockResolvedValue({
      channelId: "channel-1",
      deltaLinkEncrypted: "enc:https://graph.microsoft.com/expired-cursor",
    })
    mocks.graphGet.mockRejectedValueOnce(new MicrosoftGraphError(410))

    const result = await runOutlookDeltaSync({
      channelId: "channel-1",
      tenantId: "tenant-1",
      requestedMode: "cron",
    })

    expect(result).toEqual({ ok: true, channelId: "channel-1", skipped: "cursor_reset" })
    expect(mocks.credentialUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        deltaLinkEncrypted: null,
        lastSyncStatus: "cursor_reset",
        syncLeaseId: null,
      }),
    }))
  });

  it("deletes removed messages and closes a conversation with no remaining messages", async () => {
    mocks.graphGet.mockResolvedValueOnce({
      value: [{ id: "deleted-message", "@removed": { reason: "deleted" } }],
      "@odata.deltaLink": "https://graph.microsoft.com/final",
    });
    mocks.messageFindUnique.mockResolvedValue({
      id: "local-message",
      conversationId: "conversation-1",
    });
    mocks.messageFindFirst.mockResolvedValue(null);

    const result = await runOutlookDeltaSync({
      channelId: "channel-1",
      tenantId: "tenant-1",
      requestedMode: "webhook",
    });

    expect(result).toEqual(expect.objectContaining({ deleted: 1 }));
    expect(mocks.messageDelete).toHaveBeenCalledWith({ where: { id: "local-message" } });
    expect(mocks.conversationUpdate).toHaveBeenCalledWith({
      where: { id: "conversation-1" },
      data: { status: "closed" },
    });
  });

  it("runs category feedback for an updated pre-existing inbound message with the pre-run job snapshot", async () => {
    mocks.messageFindUnique.mockResolvedValue({ id: "local-message" });
    mocks.writebackFindUnique.mockResolvedValue({
      status: "completed",
      providerMessageIdsJson: { threadId: "graph-thread-1", labels: ["Needs Reply"] },
    });
    mocks.graphGet.mockResolvedValueOnce({
      value: [message("message-1", "2026-06-24T12:00:00.000Z", { categories: ["Handled"] })],
      "@odata.deltaLink": "https://graph.microsoft.com/final",
    });

    await runOutlookDeltaSync({
      channelId: "channel-1",
      tenantId: "tenant-1",
      requestedMode: "manual",
    });

    expect(mocks.applyCategoryFeedback).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      messageCategories: ["Handled"],
      priorJob: { settled: true, labels: ["Needs Reply"] },
    });
  });

  it("learns a genuine pre-run edit even when projection rewrites the job during the run", async () => {
    // Delegate to the real implementation so the test observes the correction
    // it records, not just the arguments it receives.
    const actual = await vi.importActual<
      typeof import("@/lib/agent/outlook-category-feedback")
    >("@/lib/agent/outlook-category-feedback");
    mocks.applyCategoryFeedback.mockImplementation(actual.applyOutlookCategoryFeedback);

    mocks.messageFindUnique.mockResolvedValue({ id: "local-message" });
    // Pre-run: FlowDesk had projected Needs Reply; the user then added Handled.
    mocks.writebackFindUnique.mockResolvedValue({
      status: "completed",
      providerMessageIdsJson: { threadId: "graph-thread-1", labels: ["Needs Reply"] },
    });
    // In-run: work-item sync re-projects, replacing the job payload. The sync
    // must have snapshotted the job BEFORE this runs.
    mocks.syncWorkItems.mockImplementation(async () => {
      mocks.writebackFindUnique.mockResolvedValue({
        status: "pending",
        providerMessageIdsJson: { threadId: "graph-thread-1", labels: ["Handled"] },
      });
    });
    mocks.graphGet.mockResolvedValueOnce({
      value: [
        message("message-1", "2026-06-24T12:00:00.000Z", {
          categories: ["Needs Reply", "Handled"],
        }),
      ],
      "@odata.deltaLink": "https://graph.microsoft.com/final",
    });

    await runOutlookDeltaSync({
      channelId: "channel-1",
      tenantId: "tenant-1",
      requestedMode: "manual",
    });

    // The feedback received the PRE-run snapshot, not the rewritten payload...
    expect(mocks.applyCategoryFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ priorJob: { settled: true, labels: ["Needs Reply"] } })
    );
    // ...so the user's added category is still learned.
    expect(mocks.applyCore).toHaveBeenCalledWith(
      expect.objectContaining({ added: ["Handled"], removed: [] })
    );
  });

  it("does not fabricate corrections from a stale snapshot when projection rewrites the job in-run", async () => {
    const actual = await vi.importActual<
      typeof import("@/lib/agent/outlook-category-feedback")
    >("@/lib/agent/outlook-category-feedback");
    mocks.applyCategoryFeedback.mockImplementation(actual.applyOutlookCategoryFeedback);

    mocks.messageFindUnique.mockResolvedValue({ id: "local-message" });
    // The mailbox categories match what FlowDesk had projected pre-run — no
    // user edit happened, this delta entry is just a classification echo.
    mocks.writebackFindUnique.mockResolvedValue({
      status: "completed",
      providerMessageIdsJson: { threadId: "graph-thread-1", labels: ["Needs Reply"] },
    });
    // In-run re-projection produces a NEW desired set. Diffing the delta
    // snapshot against this rewritten payload would fabricate "user removed
    // Handled" — the reviewer's phantom-correction scenario.
    mocks.syncWorkItems.mockImplementation(async () => {
      mocks.writebackFindUnique.mockResolvedValue({
        status: "pending",
        providerMessageIdsJson: { threadId: "graph-thread-1", labels: ["Handled"] },
      });
    });
    mocks.graphGet.mockResolvedValueOnce({
      value: [message("message-1", "2026-06-24T12:00:00.000Z", { categories: ["Needs Reply"] })],
      "@odata.deltaLink": "https://graph.microsoft.com/final",
    });

    await runOutlookDeltaSync({
      channelId: "channel-1",
      tenantId: "tenant-1",
      requestedMode: "manual",
    });

    expect(mocks.applyCore).not.toHaveBeenCalled();
  });

  it("does not run category feedback for a brand-new inbound message", async () => {
    mocks.messageFindUnique.mockResolvedValue(null);
    mocks.graphGet.mockResolvedValueOnce({
      value: [message("message-1", "2026-06-24T12:00:00.000Z", { categories: ["Handled"] })],
      "@odata.deltaLink": "https://graph.microsoft.com/final",
    });

    await runOutlookDeltaSync({
      channelId: "channel-1",
      tenantId: "tenant-1",
      requestedMode: "manual",
    });

    expect(mocks.applyCategoryFeedback).not.toHaveBeenCalled();
  });

  it("clears the label override when a genuinely new inbound message arrives", async () => {
    mocks.messageFindUnique.mockResolvedValue(null);
    mocks.graphGet.mockResolvedValueOnce({
      value: [message("message-1")],
      "@odata.deltaLink": "https://graph.microsoft.com/final",
    });

    await runOutlookDeltaSync({
      channelId: "channel-1",
      tenantId: "tenant-1",
      requestedMode: "manual",
    });

    expect(mocks.clearLabelOverride).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
    });
  });

  it("does not clear the label override for an updated pre-existing message", async () => {
    mocks.messageFindUnique.mockResolvedValue({ id: "local-message" });
    mocks.graphGet.mockResolvedValueOnce({
      value: [message("message-1", "2026-06-24T12:00:00.000Z", { categories: ["Handled"] })],
      "@odata.deltaLink": "https://graph.microsoft.com/final",
    });

    await runOutlookDeltaSync({
      channelId: "channel-1",
      tenantId: "tenant-1",
      requestedMode: "manual",
    });

    expect(mocks.clearLabelOverride).not.toHaveBeenCalled();
  });

  it("flips gmailUnread to false when the last unread inbound becomes read", async () => {
    mocks.messageFindUnique.mockResolvedValue({ id: "local-message" });
    mocks.messageCount.mockResolvedValue(0);
    mocks.graphGet.mockResolvedValueOnce({
      value: [message("message-1", "2026-06-24T12:00:00.000Z", { isRead: true })],
      "@odata.deltaLink": "https://graph.microsoft.com/final",
    });

    await runOutlookDeltaSync({
      channelId: "channel-1",
      tenantId: "tenant-1",
      requestedMode: "manual",
    });

    expect(mocks.conversationUpdate).toHaveBeenCalledWith({
      where: { id: "conversation-1" },
      data: expect.objectContaining({ gmailUnread: false }),
    });
  });

  it("returns without Graph access when another owner holds the lease", async () => {
    mocks.credentialUpdateMany.mockResolvedValueOnce({ count: 0 });

    const result = await runOutlookDeltaSync({
      channelId: "channel-1",
      tenantId: "tenant-1",
      requestedMode: "manual",
    });

    expect(result).toEqual({ ok: true, channelId: "channel-1", skipped: "sync_in_progress" });
    expect(mocks.graphGet).not.toHaveBeenCalled();
    expect(mocks.getToken).not.toHaveBeenCalled();
  });

  it("atomically reclaims an absent or expired lease and releases only its owner ID", async () => {
    mocks.graphGet.mockResolvedValueOnce({
      value: [],
      "@odata.deltaLink": "https://graph.microsoft.com/final",
    });

    await runOutlookDeltaSync({
      channelId: "channel-1",
      tenantId: "tenant-1",
      requestedMode: "cron",
    });

    const acquire = mocks.credentialUpdateMany.mock.calls[0][0];
    expect(acquire.where).toEqual({
      channelId: "channel-1",
      OR: [{ syncLockExpiresAt: null }, { syncLockExpiresAt: { lt: expect.any(Date) } }],
    });
    expect(acquire.data).toEqual(expect.objectContaining({
      syncLeaseId: expect.any(String),
      syncLockExpiresAt: expect.any(Date),
      lastSyncStatus: "running",
    }));

    const release = mocks.credentialUpdateMany.mock.calls.at(-1)?.[0];
    expect(release.where).toEqual({
      channelId: "channel-1",
      syncLeaseId: acquire.data.syncLeaseId,
    });
    expect(release.data).toEqual(expect.objectContaining({
      syncLeaseId: null,
      syncLockExpiresAt: null,
    }));
  });
});
