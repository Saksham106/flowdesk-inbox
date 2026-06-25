import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("QuietlyHandledBanner", () => {
  it("links to /inbox?status=closed", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/QuietlyHandledBanner.tsx"),
      "utf8"
    )
    expect(source).toContain("/inbox?status=closed")
    expect(source).not.toContain("attention=fyi_done")
  })

  it("uses updated microcopy", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/QuietlyHandledBanner.tsx"),
      "utf8"
    )
    expect(source).toContain("emails sorted quietly")
    expect(source).not.toContain("emails quietly handled")
  })
})
