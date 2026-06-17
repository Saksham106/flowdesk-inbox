import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import {
  extractListUnsubscribeHeader,
  isSafeUnsubscribeUrl,
  parseUnsubscribeInfo,
} from "@/lib/agent/unsubscribe"

describe("parseUnsubscribeInfo", () => {
  it("extracts List-Unsubscribe header URL", () => {
    const result = parseUnsubscribeInfo(
      "<https://example.com/unsubscribe?token=abc123>",
      "Check out our newsletter. Click here to read more."
    )
    expect(result.hasUnsubscribeLink).toBe(true)
    expect(result.unsubscribeUrl).toBe("https://example.com/unsubscribe?token=abc123")
  })

  it("extracts unsubscribe link from body when no header", () => {
    const result = parseUnsubscribeInfo(
      null,
      'To unsubscribe from these emails, <a href="https://example.com/optout">click here</a>.'
    )
    expect(result.hasUnsubscribeLink).toBe(true)
    expect(result.unsubscribeUrl).toContain("optout")
  })

  it("returns false when no unsubscribe link present", () => {
    const result = parseUnsubscribeInfo(null, "Hey, just wanted to say hi!")
    expect(result.hasUnsubscribeLink).toBe(false)
    expect(result.unsubscribeUrl).toBeNull()
  })

  it("skips mailto: links", () => {
    const result = parseUnsubscribeInfo("<mailto:unsub@example.com>", "some body text")
    expect(result.hasUnsubscribeLink).toBe(false)
  })

  it("extracts a List-Unsubscribe header from raw message text", () => {
    const raw = [
      "From: Newsletter <news@example.com>",
      "List-Unsubscribe: <https://example.com/unsubscribe?token=abc123>, <mailto:unsub@example.com>",
      "",
      "<p>Hello</p>",
    ].join("\n")

    expect(extractListUnsubscribeHeader(raw)).toBe(
      "<https://example.com/unsubscribe?token=abc123>, <mailto:unsub@example.com>"
    )
  })

  it("allows public http unsubscribe URLs", () => {
    expect(isSafeUnsubscribeUrl("https://example.com/unsubscribe?token=abc123")).toBe(true)
  })

  it("rejects local and private-network unsubscribe URLs", () => {
    expect(isSafeUnsubscribeUrl("http://localhost/unsubscribe")).toBe(false)
    expect(isSafeUnsubscribeUrl("http://127.0.0.1/unsubscribe")).toBe(false)
    expect(isSafeUnsubscribeUrl("http://10.0.0.5/unsubscribe")).toBe(false)
    expect(isSafeUnsubscribeUrl("http://192.168.1.10/unsubscribe")).toBe(false)
    expect(isSafeUnsubscribeUrl("http://172.16.0.2/unsubscribe")).toBe(false)
  })

  it("rejects malformed or credentialed unsubscribe URLs", () => {
    expect(isSafeUnsubscribeUrl("notaurl")).toBe(false)
    expect(isSafeUnsubscribeUrl("ftp://example.com/unsubscribe")).toBe(false)
    expect(isSafeUnsubscribeUrl("https://user:pass@example.com/unsubscribe")).toBe(false)
  })
})

describe("unsubscribe route safety", () => {
  it("checks the stored URL before server-side fetch", () => {
    const source = readFileSync(
      join(process.cwd(), "app/api/conversations/[id]/unsubscribe/route.ts"),
      "utf8"
    )

    expect(source).toContain("isSafeUnsubscribeUrl")
    expect(source).toContain("redirect: \"manual\"")
    expect(source).toContain("AbortSignal.timeout")
  })
})
