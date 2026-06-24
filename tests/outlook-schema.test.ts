import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Outlook durable sync schema", () => {
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");

  it("stores encrypted cursor, subscription health, and owned lease metadata", () => {
    expect(schema).toMatch(/deltaLinkEncrypted\s+String\?/);
    expect(schema).toMatch(/subscriptionId\s+String\?\s+@unique/);
    expect(schema).toMatch(/subscriptionClientStateEncrypted\s+String\?/);
    expect(schema).toMatch(/subscriptionExpiresAt\s+DateTime\?/);
    expect(schema).toMatch(/subscriptionLastRenewalAttempt\s+DateTime\?/);
    expect(schema).toMatch(/subscriptionError\s+String\?/);
    expect(schema).toMatch(/lastSyncMode\s+String\?/);
    expect(schema).toMatch(/lastSyncStatus\s+String\?/);
    expect(schema).toMatch(/syncLeaseId\s+String\?/);
    expect(schema).toMatch(/syncLockExpiresAt\s+DateTime\?/);
  });

  it("stores idempotent, bounded Outlook notification hints", () => {
    expect(schema).toContain("model OutlookSyncEvent {");
    expect(schema).toMatch(/notificationId\s+String\s+@unique/);
    expect(schema).toContain("@@index([status, nextAttemptAt])");
    expect(schema).toContain("@@index([tenantId, channelId])");
    expect(schema).toContain("outlookSyncEvents");
  });
});
