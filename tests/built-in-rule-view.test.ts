import { describe, expect, it } from "vitest"

import { builtInRuleRows } from "@/lib/built-in-rule-view"
import { FLOWDESK_GMAIL_LABEL_NAMES } from "@/lib/gmail-labels"

describe("builtInRuleRows", () => {
  it("returns every canonical label in canonical order with descriptions", () => {
    const rows = builtInRuleRows([])
    expect(rows.map((row) => row.label)).toEqual(FLOWDESK_GMAIL_LABEL_NAMES)
    expect(rows.every((row) => row.description.length > 0)).toBe(true)
  })

  it("defaults missing mappings to enabled and respects explicit state", () => {
    const rows = builtInRuleRows([
      { canonical: "Marketing", enabled: false },
      { canonical: "Newsletter", enabled: true },
    ])
    expect(rows.find((row) => row.label === "Marketing")?.enabled).toBe(false)
    expect(rows.find((row) => row.label === "Newsletter")?.enabled).toBe(true)
    expect(rows.find((row) => row.label === "Needs Reply")?.enabled).toBe(true)
  })
})
