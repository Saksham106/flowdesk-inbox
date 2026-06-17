import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { denormalizeConversationStateMetadata } from "@/lib/agent/conversation-state-metadata"

describe("denormalizeConversationStateMetadata", () => {
  it("extracts hot filter fields from metadataJson", () => {
    expect(
      denormalizeConversationStateMetadata({
        attentionCategory: "needs_action",
        emailType: "notification",
        isSalesLead: true,
        isSupport: false,
      })
    ).toEqual({
      attentionCategory: "needs_action",
      emailType: "notification",
      isSalesLead: true,
      isSupport: false,
    })
  })

  it("normalizes missing or invalid metadata fields to null or false", () => {
    expect(
      denormalizeConversationStateMetadata({
        attentionCategory: 42,
        emailType: null,
        isSalesLead: "true",
        isSupport: 1,
      })
    ).toEqual({
      attentionCategory: null,
      emailType: null,
      isSalesLead: false,
      isSupport: false,
    })
  })
})

describe("home and conversation performance safeguards", () => {
  it("keeps the inbox home query small and avoids the duplicate persisted-state ID subquery", () => {
    const source = readFileSync(join(process.cwd(), "app/inbox/page.tsx"), "utf8")

    expect(source).toContain("const HOME_CONVERSATION_LIMIT = 25")
    expect(source).toContain("const HOME_MESSAGE_LIMIT = 5")
    expect(source).toContain("export const revalidate = 60")
    expect(source).not.toContain("Fetch persisted command center states for the 75 conversations")
    expect(source).not.toContain("take: 75")
    expect(source).not.toContain("take: 20")
  })

  it("caps conversation detail messages and does not sync work items on every page open", () => {
    const source = readFileSync(join(process.cwd(), "app/conversations/[id]/page.tsx"), "utf8")

    expect(source).toContain("const CONVERSATION_MESSAGE_LIMIT = 50")
    expect(source).toContain("export const revalidate = 60")
    expect(source).toContain("take: CONVERSATION_MESSAGE_LIMIT")
    expect(source).toContain("<AutoRefresh intervalMs={60000} />")
    expect(source).not.toContain("syncConversationWorkItems")
    expect(source).not.toContain("<AutoRefresh intervalMs={8000} />")
  })

  it("uses cached indexed list filters instead of JSON metadata path filters", () => {
    const source = readFileSync(join(process.cwd(), "app/components/AppListColumn.tsx"), "utf8")

    expect(source).toContain("unstable_cache")
    expect(source).toContain("tags: [inboxTag(input.tenantId)]")
    expect(source).toContain("isSalesLead: true")
    expect(source).not.toContain('path: ["isSalesLead"]')
  })
})
