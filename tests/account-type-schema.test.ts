import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("account type schema cleanup", () => {
  it("removes the deprecated Tenant accountType storage identity", () => {
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8")

    expect(schema).not.toMatch(/\benum AccountType\b/)
    expect(schema).not.toMatch(/\baccountType\s+AccountType\b/)
    expect(schema).toMatch(/\bsalesCrmEnabled\s+Boolean\b/)
  })
})
