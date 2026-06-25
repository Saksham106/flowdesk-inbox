import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("email workflow UI wiring", () => {
  it("does not pass sent drafts back into the reply composer after refresh", () => {
    const source = readFileSync("app/conversations/[id]/page.tsx", "utf8")

    expect(source).toContain('conversation.draft.status !== "sent"')
    expect(source).toContain("initialDraft={")
    expect(source).toContain("activeDraft")
  })

  it("detail and dashboard Done actions use the workflow-status endpoint", () => {
    const statusButton = readFileSync("app/conversations/[id]/StatusButton.tsx", "utf8")
    const handleFirst = readFileSync("app/components/HandleFirstSection.tsx", "utf8")

    expect(statusButton).toContain("/workflow-status")
    expect(statusButton).toContain('workflowStatus: nextStatus')
    expect(handleFirst).toContain("/workflow-status")
    expect(handleFirst).toContain('workflowStatus: "done"')
  })

  it("composer offers Done and Waiting On immediately after send", () => {
    const source = readFileSync("app/conversations/[id]/ReplyComposer.tsx", "utf8")

    expect(source).toContain('setNotice("Sent. What should happen next?")')
    expect(source).toContain('setWorkflowStatus("done")')
    expect(source).toContain('setWorkflowStatus("waiting_on")')
  })
})
