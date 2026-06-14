export type EmailType = "needs_reply" | "notification" | "newsletter" | "marketing" | "fyi"
export type AttentionCategory =
  | "needs_reply"
  | "needs_action"
  | "review_soon"
  | "read_later"
  | "waiting_on"
  | "fyi_done"
  | "quiet"

export type EmailClassifierInput = {
  fromEmail: string
  subject: string
  body: string
}

export type EmailClassifierResult = {
  emailType: EmailType
  attentionCategory: AttentionCategory
  reason: string
  confidence: number
  extractedCode?: string
  expiresIn?: string
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
  // Social / professional networks
  "linkedin.com",
  "e.linkedin.com",
  "bounces.linkedin.com",
  "facebookmail.com",
  "twitter.com",
  "notifications.google.com",
  // Common e-commerce / marketing platforms
  "target.com",
  "amazon.com",
  "amazonses.com",
  "klaviyo.com",
  "constantcontact.com",
  "hubspot.com",
  "salesforce.com",
  "marketo.net",
  "exacttarget.com",
  // Education / test-prep platforms (typically automated)
  "nextadmit.com",
  "collegeboard.org",
  "act.org",
  "khanacademy.org",
  "coursera.org",
  "udemy.com",
])

// Subdomains used by marketing email platforms: em.company.com, e.company.com, email.company.com
const MARKETING_SUBDOMAIN_PATTERN = /^(em|e|email|mail|go|info|news|newsletter|promo|campaign|offers?|marketing|updates?|alerts?|notifications?)\./i

const GOOGLE_NOTIFICATION_DOMAIN_PATTERN = /^(docs|drive|accounts|no-reply|mail)\.google\.com$/

const MICROSOFT_NOTIFICATION_DOMAIN_PATTERN = /^(azure|visualstudio|devops|outlook)\./i

const NOTIFICATION_SUBJECT_PATTERN =
  /(\[github\]|pr #\d|pull request|merged into|pushed to|invited you to|shared .{0,40} with you|azure devops|build (succeeded|failed)|deployment |your project on |supabase)/i

// Body-based patterns for security/transactional notifications (no subject available)
const NOTIFICATION_BODY_PATTERN =
  /\b(new sign.{0,6}in|sign.{0,6}in from|new login|login from|account (accessed|signed in|activity)|security alert|security notice|unusual (sign.{0,6}in|activity|login)|suspicious (sign.{0,6}in|activity)|reset your password|password (reset|was (changed|updated))|verify your email|confirm your email|email (verification|confirmation)|one.time (password|code|pin)|your verification code|your (otp|2fa) code|authentication code|your .{0,20}code is|access code|sign.in attempt|we noticed .{0,30}sign|someone signed in)\b/i

const OTP_PATTERN =
  /\b(one[-\s]?time (passcode|password|code|pin)|verification code|security code|authentication code|login code|access code|2fa code|mfa code|otp)\b/i
const CODE_PATTERN = /\b(\d{4,8}|[A-Z0-9]{3,4}(?:[- ]?[A-Z0-9]{3,4}){1,2})\b/i
const EXPIRES_PATTERN =
  /\bexpires?\s+(?:in|after)\s+(\d+\s*(?:minutes?|mins?|hours?|hrs?|days?))\b/i
const PASSWORD_ACTION_PATTERN =
  /\b(reset your password|password reset|create (a )?password|set up (a )?password|choose (a )?password)\b/i
const VERIFY_ACCOUNT_PATTERN =
  /\b(verify your (email|account)|confirm your (email|account)|activate your account|complete your account setup|finish setting up your account)\b/i
const SECURITY_REVIEW_PATTERN =
  /\b(security alert|security notice|suspicious|unusual (activity|login|sign.{0,6}in)|new (personal access )?token|token (created|added|generated)|new ssh key|recovery email changed|password was changed|new sign.{0,6}in|login from a new device)\b/i
const BILLING_PROBLEM_PATTERN =
  /\b(payment failed|failed payment|could not process your payment|billing problem|invoice overdue|past due|card declined|subscription suspended|service interruption|action required.{0,40}(billing|payment|invoice))\b/i
const CALENDAR_INVITE_PATTERN =
  /\b(calendar invitation|invited you to|rsvp|respond to this invitation|accepted:|declined:|tentative:|meeting invitation)\b/i
const DELIVERY_ISSUE_PATTERN =
  /\b(delivery (delayed|failed|exception|issue)|shipment (delayed|failed)|unable to deliver|package delayed|delivery attempt)\b/i
const LINKEDIN_JOB_ALERT_PATTERN =
  /\b(linkedin job alert|new jobs for|jobs you may be interested in|your job alert)\b/i
const FYI_DONE_PATTERN =
  /\b(no action (is )?(needed|required)|for your records|receipt|payment received|all set|completed successfully|successfully updated|confirmed)\b/i

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

function result(
  emailType: EmailType,
  attentionCategory: AttentionCategory,
  reason: string,
  confidence: number,
  extras: Pick<EmailClassifierResult, "extractedCode" | "expiresIn"> = {}
): EmailClassifierResult {
  return { emailType, attentionCategory, reason, confidence, ...extras }
}

function combinedText(subject: string, body: string): string {
  return `${subject}\n${body}`.trim()
}

function extractVerificationCode(text: string): string | undefined {
  const afterPhrase = text.match(
    /\b(?:verification|security|authentication|login|access|2fa|mfa|one[-\s]?time)?\s*(?:code|passcode|password|pin|otp)\s+(?:is|:)\s*([A-Z0-9][A-Z0-9 -]{3,14}[A-Z0-9])\b/i
  )
  if (afterPhrase?.[1]) return afterPhrase[1].replace(/\s|-/g, "")

  const match = text.match(CODE_PATTERN)
  if (!match?.[1]) return undefined
  return match[1].replace(/\s|-/g, "")
}

function extractExpiry(text: string): string | undefined {
  const match = text.match(EXPIRES_PATTERN)
  return match?.[1]?.replace(/\s+/g, " ")
}

export function classifyEmailType(input: EmailClassifierInput): EmailClassifierResult {
  const { subject, body } = input
  const text = combinedText(subject, body)
  const domain = extractDomain(input.fromEmail)
  const localPart = extractLocalPart(input.fromEmail)

  if (OTP_PATTERN.test(text)) {
    return result("notification", "needs_action", "Verification code requires user action.", 0.95, {
      extractedCode: extractVerificationCode(text),
      expiresIn: extractExpiry(text),
    })
  }

  if (PASSWORD_ACTION_PATTERN.test(text)) {
    return result("notification", "needs_action", "Password setup or reset link requires user action.", 0.94, {
      expiresIn: extractExpiry(text),
    })
  }

  if (VERIFY_ACCOUNT_PATTERN.test(text)) {
    return result("notification", "needs_action", "Account verification or setup requires user action.", 0.93, {
      expiresIn: extractExpiry(text),
    })
  }

  if (CALENDAR_INVITE_PATTERN.test(text)) {
    return result("notification", "needs_action", "Calendar invite or RSVP requires a user decision.", 0.9)
  }

  if (SECURITY_REVIEW_PATTERN.test(text)) {
    return result("notification", "review_soon", "Security-sensitive account alert should be reviewed soon.", 0.93)
  }

  if (BILLING_PROBLEM_PATTERN.test(text)) {
    return result("notification", "review_soon", "Billing or payment issue should be reviewed soon.", 0.9)
  }

  if (DELIVERY_ISSUE_PATTERN.test(text)) {
    return result("notification", "review_soon", "Delivery issue may require attention.", 0.86)
  }

  if (LINKEDIN_JOB_ALERT_PATTERN.test(text) && /linkedin\.com$/.test(domain)) {
    return result("marketing", "quiet", "Automated LinkedIn job alert.", 0.85)
  }

  // Rule 1: No-reply local part
  if (NO_REPLY_LOCAL_PATTERN.test(localPart)) {
    return result("notification", "fyi_done", "Automated no-reply notification with no detected action.", 0.75)
  }

  // Rule 2: Known notification domains
  if (
    NOTIFICATION_DOMAINS.has(domain) ||
    GOOGLE_NOTIFICATION_DOMAIN_PATTERN.test(domain) ||
    MICROSOFT_NOTIFICATION_DOMAIN_PATTERN.test(domain)
  ) {
    return result("notification", "fyi_done", "Known automated notification sender.", 0.78)
  }

  // Rule 2b: Marketing subdomains (em.company.com, e.company.com, email.company.com, etc.)
  if (MARKETING_SUBDOMAIN_PATTERN.test(domain)) {
    return result("marketing", "quiet", "Marketing or campaign sender subdomain.", 0.82)
  }

  // Rule 3: Subject-based notification patterns
  if (NOTIFICATION_SUBJECT_PATTERN.test(subject)) {
    return result("notification", "fyi_done", "Automated product or workflow notification.", 0.78)
  }

  // Rule 4: Security/transactional notification body patterns
  if (NOTIFICATION_BODY_PATTERN.test(body)) {
    return result("notification", "fyi_done", "Automated account notification with no detected action.", 0.76)
  }

  // Rule 5: Newsletter body patterns (unsubscribe links, "do not reply", etc.)
  if (NEWSLETTER_BODY_PATTERN.test(body)) {
    return result("newsletter", "read_later", "Newsletter or product update the user may want to read later.", 0.76)
  }

  // Rule 6: Marketing subject patterns (fires when subject hint is available)
  if (MARKETING_SUBJECT_PATTERN.test(subject)) {
    return result("marketing", "quiet", "Promotional marketing email.", 0.86)
  }

  // Rule 7: Marketing body patterns
  if (MARKETING_BODY_PATTERN.test(body)) {
    return result("marketing", "quiet", "Promotional marketing email.", 0.84)
  }

  if (FYI_DONE_PATTERN.test(text)) {
    return result("fyi", "fyi_done", "Informational email appears complete with no action required.", 0.72)
  }

  return result("needs_reply", "needs_reply", "Human message likely expects a reply.", 0.7)
}
