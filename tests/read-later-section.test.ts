import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("ReadLaterSection", () => {
  it("has Done and Not interested labeled buttons", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/ReadLaterSection.tsx"),
      "utf8"
    )
    expect(source).toContain("Not interested")
    expect(source).toContain("Done")
    expect(source).not.toContain("Mark as FYI")
    expect(source).not.toContain("Mark as Quiet")
  })

  it("has inline undo state", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/ReadLaterSection.tsx"),
      "utf8"
    )
    expect(source).toContain("undoable")
    expect(source).toContain("undoTimerRef")
    expect(source).toContain("Undo")
  })

  it("links +N more to /inbox?attention=read_later", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/ReadLaterSection.tsx"),
      "utf8"
    )
    expect(source).toContain("/inbox?attention=read_later")
  })
})
