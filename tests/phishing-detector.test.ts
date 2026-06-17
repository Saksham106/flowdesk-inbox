import { describe, it, expect } from "vitest"
import { detectPhishing, type PhishingResult } from "@/lib/agent/phishing-detector"

describe("detectPhishing", () => {
  it("flags likely phishing: lookalike domain + urgency + account language", () => {
    const result = detectPhishing(
      "support@paypa1.com",
      "paypa1@phishers.com",
      "Your account has been suspended",
      "Verify your account immediately or it will be permanently deleted. Click here: http://paypa1.com/verify"
    )
    expect(result.verdict).toBe("likely_phishing")
    expect(result.score).toBeGreaterThanOrEqual(70)
    expect(result.signals).toContain("lookalike_domain")
  })

  it("flags suspicious: IRS impersonation on non-irs.gov domain", () => {
    const result = detectPhishing(
      "IRS Tax Department <irs-notice@taxalert.net>",
      "irs-notice@taxalert.net",
      "Urgent: IRS Notice — action required",
      "You owe $1,847 in back taxes. Pay immediately to avoid penalties."
    )
    expect(result.verdict).not.toBe("safe")
    expect(result.signals.length).toBeGreaterThan(0)
  })

  it("does not flag legitimate PayPal email", () => {
    const result = detectPhishing(
      "service@paypal.com",
      "service@paypal.com",
      "Your PayPal receipt",
      "You sent $50.00 to Jane Doe."
    )
    expect(result.verdict).toBe("safe")
  })

  it("flags 'you have won' scam phrase", () => {
    const result = detectPhishing(
      "winner@prize-notify.com",
      "winner@prize-notify.com",
      "Congratulations! You have won $10,000",
      "You have won our weekly lottery. Send us your details to claim your prize."
    )
    expect(result.score).toBeGreaterThan(30)
  })
})
