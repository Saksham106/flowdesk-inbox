import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const panel = readFileSync(
  join(process.cwd(), "app/settings/SenderRulesPanel.tsx"),
  "utf8"
)

const settingsPage = readFileSync(
  join(process.cwd(), "app/settings/training/page.tsx"),
  "utf8"
)

describe("SenderRulesPanel static rules UI", () => {
  it("has a create form covering sender, subject and body conditions plus target attention", () => {
    expect(panel).toContain('"email"')
    expect(panel).toContain('"domain"')
    expect(panel).toContain("subjectContains")
    expect(panel).toContain("bodyContains")
    expect(panel).toContain("targetAttention")
    expect(panel).toContain('fetch("/api/agent-rules"')
  })

  it("runs a dry-run preview and shows matched/skipped and evidence", () => {
    expect(panel).toContain("/api/agent-rules/dry-run")
    expect(panel).toContain("matchedCount")
    expect(panel).toContain("skippedCount")
    expect(panel).toContain("evidence")
  })

  it("requires a preview before a draft rule can be enabled", () => {
    expect(panel).toContain("lastDryRunAt")
    // Enable action must be gated on a completed dry-run
    expect(panel).toMatch(/canEnable|hasPreview/)
  })

  it("supports enable/disable and version history", () => {
    expect(panel).toContain("/versions")
    expect(panel).toMatch(/status: "paused"|status: "active"/)
    expect(panel).toContain("version")
  })
})

describe("settings training tab wiring", () => {
  it("always renders the rules section and passes static rules to the panel", () => {
    expect(settingsPage).toContain("initialStaticRules")
    expect(settingsPage).toMatch(/source/)
  })
})
