import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  credentialFindUnique: vi.fn(),
  credentialUpdate: vi.fn(),
  getToken: vi.fn(),
  graphRequest: vi.fn(),
  encrypt: vi.fn((value: string) => `enc:${value}`),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    outlookCredential: {
      findUnique: mocks.credentialFindUnique,
      update: mocks.credentialUpdate,
    },
  },
}));

vi.mock("@/lib/crypto", () => ({ encryptString: mocks.encrypt }));

vi.mock("@/lib/microsoft", () => {
  class MicrosoftGraphError extends Error {
    constructor(public readonly status: number) {
      super(`Microsoft Graph request failed (${status})`);
    }
  }
  return {
    MICROSOFT_GRAPH_ROOT: "https://graph.microsoft.com/v1.0",
    MicrosoftGraphError,
    getOutlookAccessToken: mocks.getToken,
    graphRequest: mocks.graphRequest,
  };
});

import { ensureOutlookSubscription } from "@/lib/outlook-subscriptions";

const previousNextAuthUrl = process.env.NEXTAUTH_URL;

describe("ensureOutlookSubscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXTAUTH_URL = "https://flowdesk.example";
    mocks.getToken.mockResolvedValue("access-token");
    mocks.credentialUpdate.mockResolvedValue({});
    mocks.credentialFindUnique.mockResolvedValue({
      channelId: "channel-1",
      subscriptionId: null,
      subscriptionExpiresAt: null,
      subscriptionClientStateEncrypted: null,
    });
  });

  afterEach(() => {
    if (previousNextAuthUrl === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = previousNextAuthUrl;
  });

  it("skips live subscription setup for local HTTP development", async () => {
    process.env.NEXTAUTH_URL = "http://localhost:3000";

    await expect(ensureOutlookSubscription("channel-1")).resolves.toEqual({
      ok: true,
      skipped: "https_required",
    });
    expect(mocks.graphRequest).not.toHaveBeenCalled();
  });

  it("does nothing when the existing subscription remains healthy", async () => {
    mocks.credentialFindUnique.mockResolvedValue({
      channelId: "channel-1",
      subscriptionId: "subscription-1",
      subscriptionExpiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      subscriptionClientStateEncrypted: "enc:client-state",
    });

    await expect(ensureOutlookSubscription("channel-1")).resolves.toEqual({
      ok: true,
      subscriptionId: "subscription-1",
      renewed: false,
    });
    expect(mocks.graphRequest).not.toHaveBeenCalled();
  });

  it("renews a subscription that expires soon", async () => {
    mocks.credentialFindUnique.mockResolvedValue({
      channelId: "channel-1",
      subscriptionId: "subscription-1",
      subscriptionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      subscriptionClientStateEncrypted: "enc:client-state",
    });
    mocks.graphRequest.mockResolvedValue({
      id: "subscription-1",
      expirationDateTime: "2026-06-30T12:00:00.000Z",
    });

    const result = await ensureOutlookSubscription("channel-1");

    expect(result).toEqual({ ok: true, subscriptionId: "subscription-1", renewed: true });
    expect(mocks.graphRequest).toHaveBeenCalledWith(
      "https://graph.microsoft.com/v1.0/subscriptions/subscription-1",
      "access-token",
      expect.objectContaining({
        method: "PATCH",
        body: expect.objectContaining({ expirationDateTime: expect.any(String) }),
      })
    );
    expect(mocks.credentialUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        subscriptionExpiresAt: new Date("2026-06-30T12:00:00.000Z"),
        subscriptionError: null,
      }),
    }));
  });

  it("creates a subscription with encrypted random clientState", async () => {
    mocks.graphRequest.mockImplementation(async (_url: string, _token: string, options: { body: Record<string, unknown> }) => ({
      id: "subscription-created",
      expirationDateTime: options.body.expirationDateTime,
    }));

    const result = await ensureOutlookSubscription("channel-1");

    expect(result).toEqual({ ok: true, subscriptionId: "subscription-created", renewed: true });
    const request = mocks.graphRequest.mock.calls[0][2];
    expect(request).toEqual(expect.objectContaining({
      method: "POST",
      body: expect.objectContaining({
        changeType: "created,updated,deleted",
        notificationUrl: "https://flowdesk.example/api/connectors/outlook/webhook",
        resource: "me/mailFolders('Inbox')/messages",
        clientState: expect.any(String),
      }),
    }));
    expect(mocks.encrypt).toHaveBeenCalledWith(request.body.clientState);
    expect(mocks.credentialUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        subscriptionId: "subscription-created",
        subscriptionClientStateEncrypted: expect.stringMatching(/^enc:/),
      }),
    }));
  });

  it("creates a replacement when Microsoft no longer has the saved subscription", async () => {
    const { MicrosoftGraphError } = await import("@/lib/microsoft");
    mocks.credentialFindUnique.mockResolvedValue({
      channelId: "channel-1",
      subscriptionId: "missing-subscription",
      subscriptionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      subscriptionClientStateEncrypted: "enc:old-state",
    });
    mocks.graphRequest
      .mockRejectedValueOnce(new MicrosoftGraphError(404))
      .mockResolvedValueOnce({
        id: "replacement-subscription",
        expirationDateTime: "2026-06-30T12:00:00.000Z",
      });

    const result = await ensureOutlookSubscription("channel-1");

    expect(result).toEqual({ ok: true, subscriptionId: "replacement-subscription", renewed: true });
    expect(mocks.graphRequest).toHaveBeenCalledTimes(2);
    expect(mocks.graphRequest.mock.calls[1][2]).toEqual(expect.objectContaining({ method: "POST" }));
  });
});
