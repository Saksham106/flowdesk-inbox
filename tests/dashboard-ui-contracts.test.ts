import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8")
}

describe("dashboard and inbox UI source contracts", () => {
  it("NeedsActionSection persists manual dismissal through workflow-status", () => {
    const s = source("app/components/NeedsActionSection.tsx")

    expect(s).toContain("Handled")
    expect(s).toContain('/api/conversations/${item.id}/workflow-status')
    expect(s).toContain('workflowStatus: "done"')
  })

  it("BillsDeadlinesList uses workflow-status for dismiss actions", () => {
    const s = source("app/components/BillsDeadlinesList.tsx")

    expect(s).toContain("/api/conversations/${item.conversationId}/workflow-status")
    expect(s).toContain('workflowStatus: "done"')
    expect(s).not.toContain("/attention")
    expect(s).not.toContain("attentionCategory")
    expect(s).toContain('aria-label="Done"')
    expect(s).toContain('aria-label="Not relevant"')
  })

  it("QuietlyHandledBanner links to closed conversations with current copy", () => {
    const s = source("app/components/QuietlyHandledBanner.tsx")

    expect(s).toContain("/inbox?status=closed")
    expect(s).not.toContain("attention=fyi_done")
    expect(s).toContain("emails sorted quietly")
    expect(s).not.toContain("emails quietly handled")
  })

  it("ReadLaterSection has explicit actions, undo, and the read-later drilldown", () => {
    const s = source("app/components/ReadLaterSection.tsx")

    expect(s).toContain("Not interested")
    expect(s).toContain("Done")
    expect(s).not.toContain("Mark as FYI")
    expect(s).not.toContain("Mark as Quiet")
    expect(s).toContain("undoable")
    expect(s).toContain("undoTimerRef")
    expect(s).toContain("Undo")
    expect(s).toContain("/inbox?attention=read_later")
  })

  it("HandleFirstSection wires snooze, waiting-on, done undo, and avoids old copy", () => {
    const s = source("app/components/HandleFirstSection.tsx")

    expect(s).toContain("SNOOZE_PRESETS")
    expect(s).toContain("Tonight (8 pm)")
    expect(s).toContain("Tomorrow morning")
    expect(s).toContain("Next week")
    expect(s).toContain("/api/conversations/${item.id}/snooze")
    expect(s).toContain("Waiting On")
    expect(s).toContain('workflowStatus: "waiting_on"')
    expect(s).toContain("undoable")
    expect(s).toContain("undoTimerRef")
    expect(s).toContain('workflowStatus: "needs_reply"')
    expect(s).toContain("Undo")
    expect(s).not.toContain("Mark Done")
  })

  it("email workflow UI does not resurrect sent drafts and offers post-send statuses", () => {
    const page = source("app/conversations/[id]/page.tsx")
    const statusButton = source("app/conversations/[id]/StatusButton.tsx")
    const handleFirst = source("app/components/HandleFirstSection.tsx")
    const composer = source("app/conversations/[id]/ReplyComposer.tsx")

    expect(page).toContain('conversation.draft.status !== "sent"')
    expect(page).toContain("initialDraft={")
    expect(page).toContain("activeDraft")
    expect(statusButton).toContain("/workflow-status")
    expect(statusButton).toContain('workflowStatus: nextStatus')
    expect(handleFirst).toContain("/workflow-status")
    expect(handleFirst).toContain('workflowStatus: "done"')
    expect(composer).toContain('setNotice("Sent. What should happen next?")')
    expect(composer).toContain('setWorkflowStatus("done")')
    expect(composer).toContain('setWorkflowStatus("waiting_on")')
  })

  it("email body UI keeps remote images blocked until explicit opt-in", () => {
    const body = source("app/components/EmailBody.tsx")
    const iframe = source("app/components/EmailBodyIframe.tsx")

    expect(body).toContain("hasRemoteEmailImages(body)")
    expect(body).toContain("sanitizeEmailHtmlForIframe(body)")
    expect(body).toContain("allowRemoteImages: true")
    expect(body).toContain("remoteHtml={remoteHtml}")
    expect(iframe).toContain("Remote images blocked for privacy")
    expect(iframe).toContain("Load images")
    expect(iframe).toContain('referrerPolicy="no-referrer"')
    expect(iframe).toContain("allowRemoteImages: remoteImagesLoaded")
    expect(iframe).toContain("setRemoteImagesLoaded(false)")
  })

  it("loading states clear through failed async paths", () => {
    const inboxRow = source("app/components/InboxRow.tsx")
    const phishing = source("app/conversations/[id]/PhishingWarningBanner.tsx")
    const support = source("app/conversations/[id]/SupportPanel.tsx")
    const scheduling = source("app/conversations/[id]/SchedulingPanel.tsx")

    expect(inboxRow).toContain("finally {")
    expect(inboxRow).toContain("setPendingAction(null)")
    expect(phishing).toContain("finally {")
    expect(phishing).toContain("setLoading(false)")
    expect(support).toContain("finally {")
    expect(support).toContain("setUseAnswerLoading(false)")
    expect(scheduling).toContain("finally {")
    expect(scheduling).toContain("setConfirmingSlot(null)")
  })

  it("AgentActivitySection renders quiet handling and current empty state", () => {
    const s = source("app/components/AgentActivitySection.tsx")

    expect(s).toContain("quietlyHandledBreakdown")
    expect(s).toContain("QuietlyHandledBreakdown")
    expect(s).toContain("newsletter")
    expect(s).toContain("Quiet")
    expect(s).not.toContain("needsActionCount")
    expect(s).not.toContain("needing action")
    expect(s).toContain("All quiet")
    expect(s).not.toContain("No agent activity yet")
  })

  it("desktop inbox list forwards VIP and snooze props", () => {
    const s = source("app/components/ClientFilteredInboxList.tsx")

    expect(s).toContain("InboxRowWithSnooze")
    expect(s).toContain("isVip?: boolean")
    expect(s).toContain("vipLabel?: string | null")
    expect(s).toContain("snoozeUntil?: string | null")
    expect(s).toContain("isVip={item.isVip}")
    expect(s).toContain("vipLabel={item.vipLabel}")
    expect(s).toContain("snoozeUntil={item.snoozeUntil}")
  })

  it("AutopilotSettingsForm keeps the trust ladder and explicit confirmation", () => {
    const s = source("app/settings/AutopilotSettingsForm.tsx")

    for (const level of [0, 1, 2, 3, 4, 5]) {
      expect(s).toContain(`level: ${level}`)
    }
    expect(s).toContain("Observe only")
    expect(s).toContain("Suggest in dashboard")
    expect(s).toContain("Organize Gmail")
    expect(s).toContain("Draft in Gmail")
    expect(s).toContain("Light autopilot")
    expect(s).toContain("Auto-send (restricted)")
    expect(s).toContain("Current")
    expect(s).toContain("pendingLevel")
    expect(s).toContain("handleConfirmLevel")
    expect(s).toContain("Confirm Level")
    expect(s).toContain("Cancel")
    expect(s).toContain("Advanced auto-send settings")
    expect(s).toContain("Enable autopilot")
    expect(s).toContain("Max auto-sends per day")
    expect(s).toContain("JSON.stringify({ automationLevel: pendingLevel })")
  })

  it("settings page exposes a navigable control-room section index", () => {
    const s = source("app/settings/page.tsx")

    expect(s).toContain("SETTINGS_SECTIONS")
    for (const id of ["connect", "gmail", "automation", "training", "profile", "data"]) {
      expect(s).toContain(`id="${id}"`)
    }
    expect(s).toContain("SETTINGS_SECTIONS.map")
    expect(s).toContain("href={`#${section.id}`}")
    expect(s).toContain("SettingsNavigation")
    expect(s).toContain("Connect")
    expect(s).toContain("Gmail behavior")
    expect(s).toContain("Automation")
    expect(s).toContain("Training")
    expect(s).toContain("Profile")
    expect(s).toContain("Data")
  })
})
