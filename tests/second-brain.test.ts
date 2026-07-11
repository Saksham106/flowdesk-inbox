import { describe, it, expect } from "vitest"
import { extractFacts } from "@/lib/agent/second-brain"

describe("extractFacts", () => {
  it("extracts birthday fact", () => {
    const facts = extractFacts(
      "Jane Doe",
      "Hi Jane",
      "My birthday is March 15th. I'd love to book a table for 6 people."
    )
    const bday = facts.find((f) => f.key === "birthday")
    expect(bday).toBeDefined()
    expect(bday?.value).toContain("March 15")
  })

  it("extracts dietary preference", () => {
    const facts = extractFacts(
      "Bob Smith",
      "Food preferences",
      "Please note I'm vegetarian and also lactose intolerant."
    )
    const diet = facts.find((f) => f.key === "dietary")
    expect(diet).toBeDefined()
    expect(diet?.value.toLowerCase()).toContain("vegetarian")
  })

  it("extracts company/role", () => {
    const facts = extractFacts(
      "Alice Chen",
      "Meeting request",
      "I'm the VP of Marketing at Acme Corp. I'd like to schedule a demo."
    )
    const role = facts.find((f) => f.key === "role")
    expect(role).toBeDefined()
  })

  it("returns empty array for generic email", () => {
    const facts = extractFacts("Unknown", "Hello", "Can you help me with this?")
    expect(facts).toHaveLength(0)
  })
})
