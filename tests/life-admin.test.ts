import { describe, it, expect } from "vitest"
import { detectLifeAdminType } from "@/lib/agent/life-admin"

describe("detectLifeAdminType", () => {
  it("detects bill due with amount and date", () => {
    const result = detectLifeAdminType(
      "noreply@xfinity.com",
      "Your bill is due on July 15 — $89.99",
      "Your Xfinity bill of $89.99 is due July 15. Pay now to avoid late fees."
    )
    expect(result.type).toBe("bill_due")
    expect(result.amount).toBe(89.99)
    expect(result.currency).toBe("USD")
  })

  it("detects travel confirmation", () => {
    const result = detectLifeAdminType(
      "reservations@delta.com",
      "Your flight confirmation — DL 1234",
      "Your Delta flight DL 1234 departs June 22 at 10:30 AM from JFK to LAX."
    )
    expect(result.type).toBe("travel_confirmation")
    expect(result.type).not.toBe(null)
  })

  it("detects medical appointment", () => {
    const result = detectLifeAdminType(
      "noreply@myhealth.com",
      "Appointment Reminder: Dr. Smith on June 25",
      "You have an appointment with Dr. Smith on June 25 at 2:00 PM."
    )
    expect(result.type).toBe("medical_appointment")
  })

  it("detects subscription renewal with amount", () => {
    const result = detectLifeAdminType(
      "billing@netflix.com",
      "Your Netflix subscription renews on July 1",
      "Your Netflix plan will automatically renew on July 1 for $15.49."
    )
    expect(result.type).toBe("subscription_renewal")
    expect(result.amount).toBe(15.49)
  })

  it("detects school notice", () => {
    const result = detectLifeAdminType(
      "noreply@school.edu",
      "Grade report available",
      "Your final grade report for Spring 2026 is now available."
    )
    expect(result.type).toBe("school_notice")
  })

  it("returns null for unrelated email", () => {
    const result = detectLifeAdminType(
      "friend@gmail.com",
      "Hey want to grab lunch?",
      "Let me know if you're free Thursday."
    )
    expect(result.type).toBeNull()
  })
})
