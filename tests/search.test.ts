import { describe, it, expect } from "vitest"
import { buildTsQuery } from "@/lib/agent/search"

describe("buildTsQuery", () => {
  it("converts single word to tsquery", () => {
    expect(buildTsQuery("invoice")).toBe("invoice:*")
  })

  it("ANDs multiple words", () => {
    expect(buildTsQuery("meeting tomorrow")).toBe("meeting:* & tomorrow:*")
  })

  it("strips special characters", () => {
    expect(buildTsQuery("invoice @#$%")).toBe("invoice:*")
  })

  it("trims whitespace", () => {
    expect(buildTsQuery("  hello  world  ")).toBe("hello:* & world:*")
  })

  it("returns empty string for blank query", () => {
    expect(buildTsQuery("")).toBe("")
  })

  it("returns empty string for query with only special chars", () => {
    expect(buildTsQuery("@#$%")).toBe("")
  })
})
