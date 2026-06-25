import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("BillsDeadlinesList", () => {
  it("calls workflow-status endpoint for conversation dismiss", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/BillsDeadlinesList.tsx"),
      "utf8"
    )
    expect(source).toContain("/api/conversations/${item.conversationId}/workflow-status")
    expect(source).toContain('workflowStatus: "done"')
    expect(source).not.toContain("/attention")
    expect(source).not.toContain("attentionCategory")
  })

  it("has Done and Not relevant labeled buttons", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/BillsDeadlinesList.tsx"),
      "utf8"
    )
    expect(source).toContain('aria-label="Done"')
    expect(source).toContain('aria-label="Not relevant"')
  })
})
