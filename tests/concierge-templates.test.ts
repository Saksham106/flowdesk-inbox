import { describe, it, expect } from "vitest"
import { DEFAULT_CONCIERGE_TEMPLATES, buildTemplateDocument } from "@/lib/agent/concierge-templates"

describe("concierge-templates", () => {
  it("has at least 6 templates", () => {
    expect(DEFAULT_CONCIERGE_TEMPLATES.length).toBeGreaterThanOrEqual(6)
  })

  it("every template has a name, category, and content", () => {
    for (const t of DEFAULT_CONCIERGE_TEMPLATES) {
      expect(t.name).toBeTruthy()
      expect(t.category).toBeTruthy()
      expect(t.content.length).toBeGreaterThan(20)
    }
  })

  it("buildTemplateDocument returns correct shape", () => {
    const doc = buildTemplateDocument(DEFAULT_CONCIERGE_TEMPLATES[0], "t1")
    expect(doc.tenantId).toBe("t1")
    expect(doc.sourceType).toBe("concierge_template")
    expect(doc.title).toContain(DEFAULT_CONCIERGE_TEMPLATES[0].name)
  })
})
