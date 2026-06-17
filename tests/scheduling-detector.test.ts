import { describe, it, expect } from "vitest"
import { detectSchedulingRequest } from "@/lib/agent/scheduling"

describe("detectSchedulingRequest", () => {
  it("detects 'can we schedule a call'", () => {
    expect(detectSchedulingRequest("Following up", "Hey, can we schedule a call this week?")).toBe(true)
  })
  it("detects 'find a time'", () => {
    expect(detectSchedulingRequest("Meeting", "Would love to find a time to connect.")).toBe(true)
  })
  it("detects 'are you available'", () => {
    expect(detectSchedulingRequest("Quick chat", "Are you available for a 30-minute chat on Thursday?")).toBe(true)
  })
  it("does not detect regular emails", () => {
    expect(detectSchedulingRequest("Invoice attached", "Please find attached invoice #1234.")).toBe(false)
  })
  it("does not detect already-scheduled confirmations", () => {
    expect(detectSchedulingRequest("Calendar invite", "You have been invited to a meeting.")).toBe(false)
  })
})
