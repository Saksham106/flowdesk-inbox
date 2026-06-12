import { describe, expect, it } from "vitest"
import { classifyEmailType } from "@/lib/agent/email-classifier"

describe("classifyEmailType", () => {
  it("classifies no-reply sender as notification", () => {
    const result = classifyEmailType({
      fromEmail: "noreply@github.com",
      subject: "Your PR was merged",
      body: "Pull request #42 was merged into main.",
    })
    expect(result.emailType).toBe("notification")
  })

  it("classifies donotreply variant as notification", () => {
    const result = classifyEmailType({
      fromEmail: "donotreply@azure.microsoft.com",
      subject: "Build succeeded",
      body: "Your build completed successfully.",
    })
    expect(result.emailType).toBe("notification")
  })

  it("classifies known notification domain porkbun as notification", () => {
    const result = classifyEmailType({
      fromEmail: "support@porkbun.com",
      subject: "Domain renewal notice",
      body: "Your domain is up for renewal.",
    })
    expect(result.emailType).toBe("notification")
  })

  it("classifies Supabase email as notification", () => {
    const result = classifyEmailType({
      fromEmail: "notifications@supabase.io",
      subject: "Project health check",
      body: "Your Supabase project is healthy.",
    })
    expect(result.emailType).toBe("notification")
  })

  it("classifies GitHub subject pattern as notification", () => {
    const result = classifyEmailType({
      fromEmail: "alerts@some-ci.com",
      subject: "[GitHub] PR #123 opened by user",
      body: "Someone opened a pull request.",
    })
    expect(result.emailType).toBe("notification")
  })

  it("classifies Google Docs share subject as notification", () => {
    const result = classifyEmailType({
      fromEmail: "drive-shares-noreply@google.com",
      subject: "Alice shared a document with you",
      body: "Click to open the document.",
    })
    expect(result.emailType).toBe("notification")
  })

  it("classifies Azure DevOps subject as notification", () => {
    const result = classifyEmailType({
      fromEmail: "azure-noreply@microsoft.com",
      subject: "Azure DevOps build failed on main",
      body: "Build pipeline failed.",
    })
    expect(result.emailType).toBe("notification")
  })

  it("classifies body with unsubscribe link as newsletter", () => {
    const result = classifyEmailType({
      fromEmail: "news@somecompany.com",
      subject: "Weekly digest",
      body: "Here are this week's updates. To unsubscribe click here.",
    })
    expect(result.emailType).toBe("newsletter")
  })

  it("classifies body with manage preferences as newsletter", () => {
    const result = classifyEmailType({
      fromEmail: "hello@product.com",
      subject: "What's new this month",
      body: "Big updates this month! Manage preferences or view in browser.",
    })
    expect(result.emailType).toBe("newsletter")
  })

  it("classifies marketing subject pattern as marketing", () => {
    const result = classifyEmailType({
      fromEmail: "deals@store.com",
      subject: "50% off today only — limited time offer",
      body: "Don't miss this deal.",
    })
    expect(result.emailType).toBe("marketing")
  })

  it("classifies free trial subject as marketing", () => {
    const result = classifyEmailType({
      fromEmail: "hello@saas.com",
      subject: "Start your free trial today",
      body: "Sign up now.",
    })
    expect(result.emailType).toBe("marketing")
  })

  it("classifies normal personal email as needs_reply", () => {
    const result = classifyEmailType({
      fromEmail: "alice@example.com",
      subject: "Can we meet Tuesday?",
      body: "Hey, are you free Tuesday afternoon to catch up?",
    })
    expect(result.emailType).toBe("needs_reply")
  })

  it("sender no-reply rule wins over newsletter body", () => {
    const result = classifyEmailType({
      fromEmail: "noreply@example.com",
      subject: "Your account update",
      body: "Your account was updated. To unsubscribe click here.",
    })
    expect(result.emailType).toBe("notification")
  })

  it("classifies pull request subject as notification", () => {
    const result = classifyEmailType({
      fromEmail: "bot@ci.example.com",
      subject: "pull request merged into main",
      body: "The pull request was merged.",
    })
    expect(result.emailType).toBe("notification")
  })

  it("classifies normal business inquiry as needs_reply", () => {
    const result = classifyEmailType({
      fromEmail: "bob@clientco.com",
      subject: "Question about pricing",
      body: "Hi, I wanted to ask about your pricing for the enterprise plan.",
    })
    expect(result.emailType).toBe("needs_reply")
  })
})
