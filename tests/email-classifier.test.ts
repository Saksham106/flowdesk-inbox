import { describe, expect, it } from "vitest"
import { classifyEmailType } from "@/lib/agent/email-classifier"

describe("classifyEmailType", () => {
  it("classifies OTP email as needs_action and extracts the code", () => {
    const result = classifyEmailType({
      fromEmail: "noreply@app.com",
      subject: "Your verification code",
      body: "Your FlowDesk verification code is 482910. This code expires in 10 minutes.",
    })
    expect(result.emailType).toBe("notification")
    expect(result.attentionCategory).toBe("needs_action")
    expect(result.extractedCode).toBe("482910")
    expect(result.expiresIn).toBe("10 minutes")
    expect(result.reason).toMatch(/verification code/i)
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it("classifies password reset email as needs_action", () => {
    const result = classifyEmailType({
      fromEmail: "support@someservice.com",
      subject: "Reset your password",
      body: "Click the link below to reset your password. This link expires in 1 hour.",
    })
    expect(result.attentionCategory).toBe("needs_action")
    expect(result.reason).toMatch(/password/i)
  })

  it("classifies GitHub token security alert as review_soon", () => {
    const result = classifyEmailType({
      fromEmail: "noreply@github.com",
      subject: "[GitHub] New personal access token added",
      body: "A fine-grained personal access token was added to your account. If this was not you, revoke it immediately.",
    })
    expect(result.emailType).toBe("notification")
    expect(result.attentionCategory).toBe("review_soon")
    expect(result.reason).toMatch(/security|token/i)
  })

  it("classifies newsletters as read_later instead of quiet", () => {
    const result = classifyEmailType({
      fromEmail: "newsletter@product.com",
      subject: "Weekly product digest",
      body: "Here are this week's updates. Manage preferences or unsubscribe.",
    })
    expect(result.emailType).toBe("newsletter")
    expect(result.attentionCategory).toBe("read_later")
  })

  it("classifies real human reply requests as needs_reply", () => {
    const result = classifyEmailType({
      fromEmail: "alice@example.com",
      subject: "Question about tomorrow",
      body: "Could you reply with the final address for tomorrow's meeting?",
    })
    expect(result.emailType).toBe("needs_reply")
    expect(result.attentionCategory).toBe("needs_reply")
  })

  it("classifies random marketing blasts as quiet", () => {
    const result = classifyEmailType({
      fromEmail: "offers@store.com",
      subject: "50% off today only",
      body: "Shop now and save big with this limited time promo code.",
    })
    expect(result.emailType).toBe("marketing")
    expect(result.attentionCategory).toBe("quiet")
  })

  it("classifies automated LinkedIn job alerts as quiet", () => {
    const result = classifyEmailType({
      fromEmail: "jobs-noreply@linkedin.com",
      subject: "New jobs for software engineer",
      body: "Your LinkedIn job alert has 12 new jobs. View jobs on LinkedIn.",
    })
    expect(result.attentionCategory).toBe("quiet")
  })

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

  // Body-based notification patterns (subject unavailable in production)
  it("classifies login alert body as notification", () => {
    const result = classifyEmailType({
      fromEmail: "security@accounts.example.com",
      subject: "",
      body: "We noticed a new sign-in to your account from Chrome on macOS.",
    })
    expect(result.emailType).toBe("notification")
  })

  it("classifies password reset body as notification", () => {
    const result = classifyEmailType({
      fromEmail: "support@someservice.com",
      subject: "",
      body: "Click the link below to reset your password. This link expires in 1 hour.",
    })
    expect(result.emailType).toBe("notification")
  })

  it("classifies OTP/verification code body as notification", () => {
    const result = classifyEmailType({
      fromEmail: "auth@app.com",
      subject: "",
      body: "Your verification code is 482910. Do not share this code with anyone.",
    })
    expect(result.emailType).toBe("notification")
  })

  it("classifies security alert body as notification", () => {
    const result = classifyEmailType({
      fromEmail: "alert@service.com",
      subject: "",
      body: "Security alert: unusual sign-in detected from a new device.",
    })
    expect(result.emailType).toBe("notification")
  })

  // Body-based marketing patterns (subject unavailable)
  it("classifies flash sale body as marketing", () => {
    const result = classifyEmailType({
      fromEmail: "deals@shop.com",
      subject: "",
      body: "Flash sale — save up to 40% this weekend only. Shop now before it ends!",
    })
    expect(result.emailType).toBe("marketing")
  })

  it("classifies 'do not reply' body as newsletter", () => {
    const result = classifyEmailType({
      fromEmail: "updates@platform.com",
      subject: "",
      body: "Your account balance is $120. Do not reply to this email — it is automated.",
    })
    expect(result.emailType).toBe("newsletter")
  })

  // Subject hint extracted from [Subject] fallback body
  it("classifies [Subject] fallback body using subject hint", () => {
    const result = classifyEmailType({
      fromEmail: "deals@store.com",
      subject: "50% off today — limited time offer",
      body: "[50% off today — limited time offer]",
    })
    expect(result.emailType).toBe("marketing")
  })
})
