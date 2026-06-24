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
  getToken: vi.fn(),
  graphGet: vi.fn(),
  encrypt: vi.fn((value: string) => `enc:${value}`),
  decrypt: vi.fn((value: string) => value.replace(/^enc:/, "")),
  syncWorkItems: vi.fn(),
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
    },
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

import { runOutlookDeltaSync } from "@/lib/outlook-sync";

function message(id: string, receivedDateTime = "2026-06-24T12:00:00.000Z") {
  return {
    id,
    conversationId: "graph-conversation-1",
    subject: "Hello",
    from: { emailAddress: { address: "sender@example.com", name: "Sender" } },
    toRecipients: [{ emailAddress: { address: "owner@example.com", name: "Owner" } }],
    body: { content: "<p>Hello there</p>", contentType: "html" },
    receivedDateTime,
    internetMessageId: `<${id}@example.com>`,
    isRead: false,
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
    mocks.syncWorkItems.mockResolvedValue(undefined);
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
