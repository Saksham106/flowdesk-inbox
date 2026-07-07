import { describe, expect, it } from "vitest"

import { archivableInGmail } from "@/lib/clean-inbox-gmail"

function conv(overrides: Partial<Parameters<typeof archivableInGmail>[0][number]> = {}) {
  return {
    id: "c1",
    channelId: "ch1",
    externalThreadId: "thread-1",
    channel: { provider: "google" },
    ...overrides,
  }
}

describe("archivableInGmail", () => {
  it("keeps only Google-backed conversations with a thread id", () => {
    const result = archivableInGmail([
      conv({ id: "gmail" }),
      conv({ id: "outlook", channel: { provider: "microsoft" } }),
      conv({ id: "no-thread", externalThreadId: null }),
      conv({ id: "no-channel", channel: null }),
    ])

    expect(result.map((c) => c.id)).toEqual(["gmail"])
  })
})
