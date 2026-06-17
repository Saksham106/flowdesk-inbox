import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('AI budget migration', () => {
  it('backfills existing usage event costs from stored token estimates', () => {
    const migration = readFileSync(
      join(process.cwd(), 'prisma/migrations/20260617001000_add_ai_budget/migration.sql'),
      'utf8'
    )

    expect(migration).toContain('SET "status" = \'succeeded\'')
    expect(migration).toContain('UPDATE "AiUsageEvent"')
    expect(migration).toContain('"estimatedInputTokens"')
    expect(migration).toContain('"estimatedOutputTokens"')
    expect(migration).toContain('"estimatedCostUsd" =')
  })
})
