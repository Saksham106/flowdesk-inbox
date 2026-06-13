export type EmailType = "needs_reply" | "notification" | "newsletter" | "marketing" | "fyi"

export type EmailClassifierInput = {
  fromEmail: string
  subject: string
  body: string
}

export type EmailClassifierResult = {
  emailType: EmailType
}

const NO_REPLY_LOCAL_PATTERN =
  /^(noreply|no-reply|donotreply|do-not-reply|do\.not\.reply|notifications?|mailer-daemon|bounce|alert|automated)$/i

const NOTIFICATION_DOMAINS = new Set([
  "github.com",
  "googleusercontent.com",
  "porkbun.com",
  "supabase.io",
  "supabase.com",
  "atlassian.net",
  "jira.com",
  "trello.com",
  "linear.app",
  "slack.com",
  "notion.so",
  "figma.com",
  "vercel.com",
  "netlify.com",
  "stripe.com",
  "twilio.com",
  "sendgrid.net",
  "mailchimp.com",
])

const GOOGLE_NOTIFICATION_DOMAIN_PATTERN = /^(docs|drive|accounts|no-reply|mail)\.google\.com$/

const MICROSOFT_NOTIFICATION_DOMAIN_PATTERN = /^(azure|visualstudio|devops|outlook)\./i

const NOTIFICATION_SUBJECT_PATTERN =
  /(\[github\]|pr #\d|pull request|merged into|pushed to|invited you to|shared .{0,40} with you|azure devops|build (succeeded|failed)|deployment |your project on |supabase)/i

// Body-based patterns for security/transactional notifications (no subject available)
const NOTIFICATION_BODY_PATTERN =
  /\b(new sign.{0,6}in|sign.{0,6}in from|new login|login from|account (accessed|signed in|activity)|security alert|security notice|unusual (sign.{0,6}in|activity|login)|suspicious (sign.{0,6}in|activity)|reset your password|password (reset|was (changed|updated))|verify your email|confirm your email|email (verification|confirmation)|one.time (password|code|pin)|your verification code|your (otp|2fa) code|authentication code|your .{0,20}code is|access code|sign.in attempt|we noticed .{0,30}sign|someone signed in)\b/i

const NEWSLETTER_BODY_PATTERN =
  /\b(unsubscribe|manage (email )?preferences|email preferences|view in browser|view this email in (your )?browser|if you no longer wish to receive|to stop receiving (these |this )?emails|you('re| are) receiving this (email )?because|update your (email )?preferences|opt.out|this is an automated|do not reply to this email)\b/i

const MARKETING_SUBJECT_PATTERN =
  /\b(\d+%\s*off|discount|limited time|special offer|early access|free trial|upgrade now|deal of the day)\b/i

const MARKETING_BODY_PATTERN =
  /\b(\d+%\s*off|exclusive (offer|deal)|limited.time offer|flash sale|cyber monday|black friday|shop now|save (up to|\d+%)|promo code|coupon code|today only|ends (tonight|soon)|don'?t miss out)\b/i

function extractDomain(email: string): string {
  const match = email.match(/@([^>\s]+)/)
  return match ? match[1].toLowerCase().replace(/[^a-z0-9._-]/g, "") : ""
}

function extractLocalPart(email: string): string {
  const normalized = email.replace(/.*</, "").replace(/>.*/, "").trim()
  const match = normalized.match(/^([^@]+)@/)
  return match ? match[1].toLowerCase() : ""
}

export function classifyEmailType(input: EmailClassifierInput): EmailClassifierResult {
  const { subject, body } = input
  const domain = extractDomain(input.fromEmail)
  const localPart = extractLocalPart(input.fromEmail)

  // Rule 1: No-reply local part
  if (NO_REPLY_LOCAL_PATTERN.test(localPart)) {
    return { emailType: "notification" }
  }

  // Rule 2: Known notification domains
  if (
    NOTIFICATION_DOMAINS.has(domain) ||
    GOOGLE_NOTIFICATION_DOMAIN_PATTERN.test(domain) ||
    MICROSOFT_NOTIFICATION_DOMAIN_PATTERN.test(domain)
  ) {
    return { emailType: "notification" }
  }

  // Rule 3: Subject-based notification patterns
  if (NOTIFICATION_SUBJECT_PATTERN.test(subject)) {
    return { emailType: "notification" }
  }

  // Rule 4: Security/transactional notification body patterns
  if (NOTIFICATION_BODY_PATTERN.test(body)) {
    return { emailType: "notification" }
  }

  // Rule 5: Newsletter body patterns (unsubscribe links, "do not reply", etc.)
  if (NEWSLETTER_BODY_PATTERN.test(body)) {
    return { emailType: "newsletter" }
  }

  // Rule 6: Marketing subject patterns (fires when subject hint is available)
  if (MARKETING_SUBJECT_PATTERN.test(subject)) {
    return { emailType: "marketing" }
  }

  // Rule 7: Marketing body patterns
  if (MARKETING_BODY_PATTERN.test(body)) {
    return { emailType: "marketing" }
  }

  return { emailType: "needs_reply" }
}
