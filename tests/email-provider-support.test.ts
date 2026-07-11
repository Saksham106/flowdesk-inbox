import { describe, expect, it } from "vitest"
import {
  MAILBOX_WRITEBACK_PROVIDERS,
  auditPrefixForProvider,
  supportsMailboxWriteback,
} from "@/lib/email/provider-support"

describe("provider support", () => {
  it("supports google and microsoft, rejects others", () => {
    expect(supportsMailboxWriteback("google")).toBe(true)
    expect(supportsMailboxWriteback("microsoft")).toBe(true)
    expect(supportsMailboxWriteback("twilio")).toBe(false)
    expect(supportsMailboxWriteback(null)).toBe(false)
    expect(supportsMailboxWriteback(undefined)).toBe(false)
    expect([...MAILBOX_WRITEBACK_PROVIDERS].sort()).toEqual(["google", "microsoft"])
  })
  it("maps providers to audit prefixes", () => {
    expect(auditPrefixForProvider("google")).toBe("gmail")
    expect(auditPrefixForProvider("microsoft")).toBe("outlook")
    expect(() => auditPrefixForProvider("twilio")).toThrow()
  })
})
