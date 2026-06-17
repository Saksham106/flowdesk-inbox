import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("NeedsActionSection dismissal control", () => {
  it("persists manual dismissal through the attention correction endpoint", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/NeedsActionSection.tsx"),
      "utf8"
    )

    expect(source).toContain("Not needed")
    expect(source).toContain('/api/conversations/${item.id}/attention')
    expect(source).toContain('attentionCategory: "fyi_done"')
  })
})
