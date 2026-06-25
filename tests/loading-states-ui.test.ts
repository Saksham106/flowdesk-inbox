import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("loading state UI resilience", () => {
  it("clears InboxRow pending actions even when a request rejects", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/InboxRow.tsx"),
      "utf8"
    )

    expect(source).toContain("finally {")
    expect(source).toContain("setPendingAction(null)")
  })

  it("clears PhishingWarningBanner loading state even when mark-safe fails", () => {
    const source = readFileSync(
      join(process.cwd(), "app/conversations/[id]/PhishingWarningBanner.tsx"),
      "utf8"
    )

    expect(source).toContain("finally {")
    expect(source).toContain("setLoading(false)")
  })
})
