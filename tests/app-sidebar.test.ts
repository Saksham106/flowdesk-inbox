import { describe, it, expect } from "vitest"
import { getSidebarSection } from "@/lib/app-sidebar"

describe("getSidebarSection", () => {
  it("returns the Mail section for /mail and /conversations/*", () => {
    const mail = getSidebarSection("/mail")
    expect(mail?.title).toBe("Mail")
    expect(mail?.items.map((i) => i.label)).toEqual([
      "Inbox", "Needs Reply", "Waiting On", "Read Later", "Done", "Drafts", "Sent",
    ])
    expect(getSidebarSection("/conversations/abc123")?.title).toBe("Mail")
  })

  it("returns the Assistant section for /assistant/*", () => {
    const section = getSidebarSection("/assistant/rules")
    expect(section?.title).toBe("Assistant")
    expect(section?.items.map((i) => i.href)).toEqual([
      "/assistant/rules", "/assistant/test-rules", "/assistant/history", "/assistant/settings",
    ])
  })

  it("returns the Cleanup section for /clean-inbox and its subroutes", () => {
    const section = getSidebarSection("/clean-inbox/unsubscribe")
    expect(section?.title).toBe("Cleanup")
    expect(section?.items.map((i) => i.href)).toEqual([
      "/clean-inbox", "/clean-inbox/unsubscribe", "/clean-inbox/analytics",
    ])
  })

  it("returns the Tools section for /tools", () => {
    expect(getSidebarSection("/tools")?.title).toBe("Tools")
  })

  it("returns null for pages without sub-navigation", () => {
    expect(getSidebarSection("/home")).toBeNull()
    expect(getSidebarSection("/approvals")).toBeNull()
    expect(getSidebarSection("/settings")).toBeNull()
    expect(getSidebarSection("/settings/connect")).toBeNull()
  })
})
