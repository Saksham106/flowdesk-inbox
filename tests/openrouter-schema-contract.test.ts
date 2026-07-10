import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

const schema = readFileSync("prisma/schema.prisma", "utf8")
const envExample = readFileSync(".env.example", "utf8")

describe("OpenRouter schema contract", () => {
  it("stores one OpenRouter child key per user", () => {
    expect(schema).toContain("model OpenRouterUserKey")
    expect(schema).toContain("userId               String   @unique")
    expect(schema).toContain("encryptedApiKey      String")
    expect(schema).toContain("keyHash              String   @unique")
  })

  it("records provider-aware AI usage", () => {
    expect(schema).toContain("userId")
    expect(schema).toContain("providerGenerationId")
    expect(schema).toContain("actualCostUsd")
    expect(schema).toContain("providerKeyHash")
  })

  it("documents OpenRouter env vars instead of OpenAI as the app default", () => {
    expect(envExample).toContain("OPENROUTER_API_KEY")
    expect(envExample).toContain("OPENROUTER_MANAGEMENT_API_KEY")
    expect(envExample).toContain("OPENROUTER_MODEL")
  })
})
