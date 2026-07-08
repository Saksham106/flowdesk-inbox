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
    expect(result.action?.type).toBe("otp_code")
    expect(result.action?.detectedCode).toBe("482910")
  })

  it("classifies verify email links with structured action metadata", () => {
    const result = classifyEmailType({
      fromEmail: "accounts@example.com",
      subject: "Verify your email",
      body: "Verify your email by visiting https://example.com/verify?token=abc. This link expires in 24 hours.",
    })

    expect(result.attentionCategory).toBe("needs_action")
    expect(result.action).toMatchObject({
      type: "verify_email",
      explanation: expect.stringMatching(/verify/i),
      actionLink: "https://example.com/verify?token=abc",
      expirationText: "24 hours",
    })
  })

  it("classifies create password links with structured action metadata", () => {
    const result = classifyEmailType({
      fromEmail: "setup@example.com",
      subject: "Create your password",
      body: "Create a password to finish account setup: https://example.com/create-password",
    })

    expect(result.attentionCategory).toBe("needs_action")
    expect(result.action?.type).toBe("create_password")
    expect(result.action?.actionLink).toBe("https://example.com/create-password")
  })

  it("classifies password reset email as needs_action", () => {
    const result = classifyEmailType({
      fromEmail: "support@someservice.com",
      subject: "Reset your password",
      body: "Click the link below to reset your password. This link expires in 1 hour.",
    })
    expect(result.attentionCategory).toBe("needs_action")
    expect(result.reason).toMatch(/password/i)
    expect(result.action?.type).toBe("reset_password")
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
    expect(result.action?.type).toBe("security_alert")
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

  it("picks the reset link over an unsubscribe link that appears first in the body", () => {
    const result = classifyEmailType({
      fromEmail: "noreply@service.com",
      subject: "Reset your password",
      body: [
        "Click here to unsubscribe: https://service.com/unsubscribe?uid=abc",
        "Reset your password: https://service.com/reset-password?token=xyz123abc",
      ].join("\n"),
    })
    expect(result.action?.actionLink).toBe("https://service.com/reset-password?token=xyz123abc")
  })

  it("picks the verify link over a tracking pixel URL that appears first", () => {
    const result = classifyEmailType({
      fromEmail: "accounts@app.com",
      subject: "Verify your email",
      body: [
        "https://track.app.com/pixel?uid=1234",
        "Verify your email: https://app.com/verify?token=abcdef",
      ].join("\n"),
    })
    expect(result.action?.actionLink).toBe("https://app.com/verify?token=abcdef")
  })

  it("returns undefined actionLink when only tracking/unsubscribe URLs are present", () => {
    const result = classifyEmailType({
      fromEmail: "noreply@service.com",
      subject: "Reset your password",
      body: "Reset your password.\nhttps://service.com/unsubscribe?uid=abc\nhttps://track.service.com/pixel?open=1",
    })
    expect(result.action?.actionLink).toBeUndefined()
  })

  it("extracts OTP from HTML email body without returning doctypehtml", () => {
    const htmlBody = `<!doctype html>
<html>
<head><style>body { font-family: sans-serif; }</style></head>
<body>
<div class="container">
  <p>Hi there,</p>
  <p>Your verification code is <strong>847291</strong>. It expires in 10 minutes.</p>
  <p>Do not share this code with anyone.</p>
</div>
</body>
</html>`
    const result = classifyEmailType({
      fromEmail: "noreply@auth.example.com",
      subject: "Your verification code",
      body: htmlBody,
    })
    expect(result.attentionCategory).toBe("needs_action")
    expect(result.action?.detectedCode).toBe("847291")
    expect(result.action?.detectedCode).not.toBe("doctypehtml")
    expect(result.extractedCode).toBe("847291")
  })

  it("does not return html keywords as a verification code", () => {
    const htmlBody = `<!DOCTYPE html><html><body><p>One-time code sent to your device.</p></body></html>`
    const result = classifyEmailType({
      fromEmail: "noreply@service.com",
      subject: "One-time code",
      body: htmlBody,
    })
    expect(result.action?.detectedCode).not.toBe("doctypehtml")
    expect(result.action?.detectedCode).not.toBe("html")
    expect(result.action?.detectedCode).not.toBe("body")
  })

  // --- Marketing vs newsletter disambiguation (the reported bug) ---
  // Marketing mail almost always carries a legally-required unsubscribe link,
  // so "has unsubscribe -> newsletter" mislabeled every sale/offer email.
  it("classifies a promo email with an unsubscribe link as marketing, not newsletter", () => {
    const result = classifyEmailType({
      fromEmail: "promo@brand.com",
      subject: "Last chance: 30% off everything",
      body: "Our biggest sale ends tonight. Shop now! Unsubscribe here or manage your preferences.",
    })
    expect(result.emailType).toBe("marketing")
    expect(result.attentionCategory).toBe("quiet")
  })

  it("classifies e-commerce 'new arrivals' with unsubscribe as marketing", () => {
    const result = classifyEmailType({
      fromEmail: "hello@boutique.com",
      subject: "New arrivals just dropped",
      body: "Check out the latest collection. Free shipping on orders over $50. Shop now.\nUnsubscribe | View in browser",
    })
    expect(result.emailType).toBe("marketing")
  })

  it("classifies a Klaviyo marketing blast as marketing, not notification", () => {
    // Klaviyo is an e-commerce marketing platform, not a notification sender —
    // it must not force everything from it to 'notification'.
    const result = classifyEmailType({
      fromEmail: "store@klaviyo.com",
      subject: "Flash sale: 40% off sitewide",
      body: "Shop the sale before it ends tonight. Unsubscribe.",
    })
    expect(result.emailType).toBe("marketing")
  })

  it("keeps an editorial newsletter with an unsubscribe link as newsletter", () => {
    const result = classifyEmailType({
      fromEmail: "hi@substack.com",
      subject: "This week in AI",
      body: "In this issue: 5 stories you missed this week. Read more online.\nUnsubscribe to stop receiving these.",
    })
    expect(result.emailType).toBe("newsletter")
    expect(result.attentionCategory).toBe("read_later")
  })

  it("classifies a Mailchimp digest as newsletter, not notification", () => {
    const result = classifyEmailType({
      fromEmail: "team@mailchimp.com",
      subject: "Your weekly roundup",
      body: "Here are this week's top stories. Read the full digest online. Unsubscribe.",
    })
    expect(result.emailType).toBe("newsletter")
  })

  it("routes a promotional email from a marketing subdomain to marketing", () => {
    const result = classifyEmailType({
      fromEmail: "hello@promo.retailer.com",
      subject: "A little something for you",
      body: "We picked these just for you. Unsubscribe.",
    })
    expect(result.emailType).toBe("marketing")
  })

  it("routes a subscribed-content email from a newsletter subdomain to newsletter", () => {
    const result = classifyEmailType({
      fromEmail: "hello@newsletter.publication.com",
      subject: "A little something for you",
      body: "Thanks for reading. Unsubscribe.",
    })
    expect(result.emailType).toBe("newsletter")
  })

  it("does not mislabel a personal email that mentions a sale as marketing", () => {
    const result = classifyEmailType({
      fromEmail: "alice@example.com",
      subject: "garage sale this weekend?",
      body: "Hey, are you still up for the garage sale on Saturday? Let me know.",
    })
    expect(result.emailType).toBe("needs_reply")
  })

  it("extracts a numeric OTP from HTML with surrounding boilerplate", () => {
    const htmlBody = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Security Code</title></head>
<body style="margin:0;padding:0">
<table width="100%"><tr><td>
<p style="font-size:16px">Use code <b>392817</b> to sign in.</p>
<p style="font-size:11px">This code expires in 5 minutes.</p>
</td></tr></table>
</body></html>`
    const result = classifyEmailType({
      fromEmail: "security@app.com",
      subject: "Your login code",
      body: htmlBody,
    })
    expect(result.action?.detectedCode).toBe("392817")
  })
})
