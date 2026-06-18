import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("Phase 3 inbox list UI wiring", () => {
  it("forwards VIP and snooze props through the desktop inbox list", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/ClientFilteredInboxList.tsx"),
      "utf8"
    )

    expect(source).toContain("InboxRowWithSnooze")
    expect(source).toContain("isVip?: boolean")
    expect(source).toContain("vipLabel?: string | null")
    expect(source).toContain("snoozeUntil?: string | null")
    expect(source).toContain("isVip={item.isVip}")
    expect(source).toContain("vipLabel={item.vipLabel}")
    expect(source).toContain("snoozeUntil={item.snoozeUntil}")
  })
})
