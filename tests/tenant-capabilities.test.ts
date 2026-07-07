import { describe, expect, it } from "vitest"

import {
  resolveCapabilities,
  accountModeFor,
  salesCrmEnabled,
} from "@/lib/tenant-capabilities"

describe("resolveCapabilities", () => {
  it("defaults to sales/CRM off (clean B2C baseline)", () => {
    expect(resolveCapabilities(null)).toEqual({ salesCrm: false })
    expect(resolveCapabilities({})).toEqual({ salesCrm: false })
    expect(resolveCapabilities({ salesCrmEnabled: false })).toEqual({ salesCrm: false })
  })

  it("enables sales/CRM only when the flag is explicitly true", () => {
    expect(resolveCapabilities({ salesCrmEnabled: true })).toEqual({ salesCrm: true })
  })

  it("treats null/undefined flag as off", () => {
    expect(resolveCapabilities({ salesCrmEnabled: null })).toEqual({ salesCrm: false })
    expect(resolveCapabilities({ salesCrmEnabled: undefined })).toEqual({ salesCrm: false })
  })
})

describe("accountModeFor (bridge to legacy internal mode)", () => {
  it("maps sales/CRM on to the business mode and off to personal", () => {
    expect(accountModeFor({ salesCrmEnabled: true })).toBe("business")
    expect(accountModeFor({ salesCrmEnabled: false })).toBe("personal")
    expect(accountModeFor(null)).toBe("personal")
  })
})

describe("salesCrmEnabled", () => {
  it("is a convenience boolean for the capability", () => {
    expect(salesCrmEnabled({ salesCrmEnabled: true })).toBe(true)
    expect(salesCrmEnabled({ salesCrmEnabled: false })).toBe(false)
    expect(salesCrmEnabled(null)).toBe(false)
  })
})
