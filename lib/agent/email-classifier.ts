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
])

const GOOGLE_NOTIFICATION_DOMAIN_PATTERN = /^(docs|drive|accounts|no-reply)\.google\.com$/

const MICROSOFT_NOTIFICATION_DOMAIN_PATTERN = /^(azure|visualstudio|devops)\./i

const NOTIFICATION_SUBJECT_PATTERN =
  /(\[github\]|pr #\d|pull request|merged into|pushed to|invited you to|shared .{0,40} with you|azure devops|build (succeeded|failed)|deployment |your project on |supabase)/i

const NEWSLETTER_BODY_PATTERN =
  /\b(unsubscribe|manage preferences|email preferences|view in browser|view this email in your browser)\b/i

const MARKETING_SUBJECT_PATTERN =
  /\b(\d+%\s*off|discount|limited time|special offer|early access|free trial|upgrade now|deal of the day)\b/i

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

  // Rule 4: Newsletter body patterns
  if (NEWSLETTER_BODY_PATTERN.test(body)) {
    return { emailType: "newsletter" }
  }

  // Rule 5: Marketing subject patterns
  if (MARKETING_SUBJECT_PATTERN.test(subject)) {
    return { emailType: "marketing" }
  }

  return { emailType: "needs_reply" }
}
