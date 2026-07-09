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

    expect(s).toContain("/mail?status=closed")
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
    expect(s).toContain("/mail?attention=read_later")
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
    // InboxRow's pending-action state/handlers live in the shared
    // useInboxRowActions hook (also used by MailInboxRow) — assert the
    // contract there rather than in InboxRow.tsx itself.
    const inboxRowActions = source("app/components/useInboxRowActions.ts")
    const phishing = source("app/conversations/[id]/PhishingWarningBanner.tsx")
    const support = source("app/conversations/[id]/SupportPanel.tsx")
    const scheduling = source("app/conversations/[id]/SchedulingPanel.tsx")

    expect(inboxRowActions).toContain("finally {")
    expect(inboxRowActions).toContain("setPendingAction(null)")
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

  it("settings is a route-based tab layout, one page per section", () => {
    const layout = source("app/settings/layout.tsx")
    const nav = source("app/settings/SettingsTabNav.tsx")
    const root = source("app/settings/page.tsx")

    expect(layout).toContain("SettingsTabNav")
    expect(nav).toContain("SETTINGS_TABS")
    expect(nav).toContain("usePathname")
    expect(nav).toContain("aria-current")
    expect(root).toContain('redirect("/settings/connect")')

    for (const slug of ["connect", "gmail", "automation", "training", "profile", "data"]) {
      expect(source(`app/settings/${slug}/page.tsx`)).toBeTruthy()
    }
  })

  it("desktop rail uses the F logo as the only Home affordance", () => {
    const rail = source("app/components/AppRail.tsx")
    const nav = source("lib/app-navigation.ts")

    expect(rail).toContain('href="/home"')
    expect(rail).toContain('aria-label="Go to FlowDesk home"')
    expect(nav).not.toContain('{ label: "Home", href: "/home" }')
  })

  it("expanded AppSidebar is removed from shell pages", () => {
    for (const path of [
      "app/mail/page.tsx",
      "app/assistant/layout.tsx",
      "app/clean-inbox/page.tsx",
      "app/clean-inbox/unsubscribe/page.tsx",
      "app/clean-inbox/analytics/page.tsx",
      "app/tools/page.tsx",
    ]) {
      expect(source(path)).not.toContain("AppSidebar")
    }
  })

  it("assistant routes render inside the app rail shell", () => {
    const layout = source("app/assistant/layout.tsx")

    expect(layout).toContain("AppRail")
    expect(layout).toContain("getAppShellContext")
  })

  it("cleanup subroutes keep the Clean rail item active", () => {
    const rail = source("app/components/AppRail.tsx")

    expect(rail).toContain('isActive: (p) => p === "/clean-inbox" || p.startsWith("/clean-inbox/")')
  })

  it("new app-shell pages mount the Ask FlowDesk panel with the rail trigger", () => {
    const shellPages = [
      "app/assistant/layout.tsx",
      "app/clean-inbox/page.tsx",
      "app/clean-inbox/unsubscribe/page.tsx",
      "app/clean-inbox/analytics/page.tsx",
      "app/tools/page.tsx",
    ]

    for (const path of shellPages) {
      const s = source(path)
      expect(s).toContain("AppRail")
      expect(s).toContain("AskFlowDeskPanel")
    }
  })

  it("desktop Mail label-tab views are preserved in query and return links", () => {
    const mail = source("app/mail/page.tsx")
    const list = source("app/components/AppListColumn.tsx")

    expect(mail).toContain("if (activeLabelTab) params.set(\"label\", activeLabelTab)")
    expect(mail).toContain("labelTab: activeLabelTab")
    expect(list).toContain("buildMailLabelTabWhere(input.labelTab)")
    expect(list).toContain('input.labelTab ?? "no-label-tab"')
  })

  it("settings exposes Gmail operator health for sync, queues, and agent jobs", () => {
    const connect = source("app/settings/connect/page.tsx")
    const panel = source("app/settings/GmailOperatorHealthPanel.tsx")

    expect(connect).toContain("GmailOperatorHealthPanel")
    expect(connect).toContain("summarizeGmailOperatorHealth")
    expect(connect).toContain("gmailWritebackQueue")
    expect(connect).toContain("gmailPushEvent")
    expect(connect).toContain("agentJob")
    expect(panel).toContain("Gmail operator health")
    expect(panel).toContain("writeback")
    expect(panel).toContain("agent jobs")
  })

  it("approvals renders in the app rail shell and explains empty state sources", () => {
    const page = source("app/approvals/page.tsx")
    const list = source("app/approvals/ApprovalList.tsx")

    expect(page).toContain("AppRail")
    expect(page).toContain("AskFlowDeskPanel")
    expect(page).toContain("getAppShellContext")
    expect(list).toContain("Draft send approvals")
    expect(list).toContain("Calendar booking approvals")
    expect(list).not.toContain("fake")
  })

  it("assistant Rules page shows a rule summary computed from all agent rules", () => {
    const page = source("app/assistant/rules/page.tsx")

    expect(page).toContain("summarizeAssistantRules")
    expect(page).toContain("summarizeAssistantRules(agentRules)")
    expect(page).toContain("function Stat(")
    expect(page).toContain("<SenderRulesPanel")
  })

  it("Test Rules is a server-loaded rule select, not a freeform id input", () => {
    const page = source("app/assistant/test-rules/page.tsx")
    const client = source("app/assistant/TestRulesClient.tsx")

    expect(page).not.toContain('"use client"')
    expect(page).toContain("prisma.agentRule.findMany")
    expect(page).toContain("<TestRulesClient rules={ruleOptions} />")
    expect(client).toContain('"use client"')
    expect(client).toContain("<select")
    expect(client).not.toContain('placeholder="Rule ID"')
    expect(client).toContain("/api/agent-rules/dry-run")
  })

  it("assistant History renders readable rule action labels with raw action as secondary text", () => {
    const page = source("app/assistant/history/page.tsx")

    expect(page).toContain("RULE_ACTION_LABELS")
    expect(page).toContain('"agent_rule.create": "Rule created"')
    expect(page).toContain("RULE_ACTION_LABELS[entry.action] ?? entry.action")
    expect(page).toContain("entry.createdAt.toLocaleString()")
  })

  it("assistant Settings clarifies automation-level gating for higher-risk actions", () => {
    const page = source("app/assistant/settings/page.tsx")

    expect(page).toContain("automation level")
    expect(page).toContain("approvals")
    expect(page).toContain("<TrainAgentPanel")
  })
})
