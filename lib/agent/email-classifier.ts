export type EmailType = "needs_reply" | "notification" | "newsletter" | "marketing" | "calendar" | "fyi"
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
  action?: {
    type:
      | "otp_code"
      | "verify_email"
      | "confirm_account"
      | "create_password"
      | "reset_password"
      | "login_approval"
      | "account_setup"
      | "security_alert"
    explanation: string
    detectedCode?: string
    actionLink?: string
    expirationText?: string
  }
}

type ActionType = NonNullable<EmailClassifierResult["action"]>["type"]

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
  // Social / professional networks
  "linkedin.com",
  "e.linkedin.com",
  "bounces.linkedin.com",
  "facebookmail.com",
  "twitter.com",
  "notifications.google.com",
  // E-commerce senders that predominantly send transactional order/account
  // mail. Their *marketing* is caught earlier by content (promo intent wins
  // before this domain check), so listing them here only routes their
  // non-promotional order/account mail to notification.
  "target.com",
  "amazon.com",
  // NOTE: pure email-service-provider / marketing-automation domains
  // (mailchimp, klaviyo, constantcontact, hubspot, marketo, exacttarget,
  // sendgrid, amazonses, salesforce) are deliberately NOT listed — they carry
  // newsletters and marketing, not notifications, so their mail classifies by
  // content instead of being forced to "notification".
  // Education / test-prep platforms (typically automated)
  "nextadmit.com",
  "collegeboard.org",
  "act.org",
  "khanacademy.org",
  "coursera.org",
  "udemy.com",
])

// Sender-subdomain hints, split by intent. These are weak signals used only
// after content-based classification, so an editorial email from promo.x.com
// still lands as newsletter on its content — the subdomain is the tiebreaker
// when the body says nothing decisive. Generic sending subdomains (em, e,
// email, mail, go, info) are intentionally omitted: they carry anything.
const MARKETING_SUBDOMAIN_PATTERN = /^(promo|promotions?|offers?|deals?|sale|sales|marketing|campaign|shop|store)\./i
const NEWSLETTER_SUBDOMAIN_PATTERN = /^(news|newsletter|newsletters|digest|weekly|daily)\./i

const GOOGLE_NOTIFICATION_DOMAIN_PATTERN = /^(docs|drive|accounts|no-reply|mail)\.google\.com$/

const MICROSOFT_NOTIFICATION_DOMAIN_PATTERN = /^(azure|visualstudio|devops|outlook)\./i

const NOTIFICATION_SUBJECT_PATTERN =
  /(\[github\]|pr #\d|pull request|merged into|pushed to|invited you to|shared .{0,40} with you|azure devops|build (succeeded|failed)|deployment |your project on |supabase)/i

// Body-based patterns for security/transactional notifications (no subject available)
const NOTIFICATION_BODY_PATTERN =
  /\b(new sign.{0,6}in|sign.{0,6}in from|new login|login from|account (accessed|signed in|activity)|security alert|security notice|unusual (sign.{0,6}in|activity|login)|suspicious (sign.{0,6}in|activity)|reset your password|password (reset|was (changed|updated))|verify your email|confirm your email|email (verification|confirmation)|one.time (password|code|pin)|your verification code|your (otp|2fa) code|authentication code|your .{0,20}code is|access code|sign.in attempt|we noticed .{0,30}sign|someone signed in)\b/i

const OTP_PATTERN =
  /\b(one[-\s]?time (passcode|password|code|pin)|verification code|security code|authentication code|login code|access code|2fa code|mfa code|otp)\b/i
const EXPIRES_PATTERN =
  /\bexpires?\s+(?:in|after)\s+(\d+\s*(?:minutes?|mins?|hours?|hrs?|days?))\b/i
const PASSWORD_ACTION_PATTERN =
  /\b(reset your password|password reset|create (a )?password|set up (a )?password|choose (a )?password)\b/i
const VERIFY_ACCOUNT_PATTERN =
  /\b(verify your (email|account)|confirm your (email|account)|activate your account|complete your account setup|finish setting up your account)\b/i
const SECURITY_REVIEW_PATTERN =
  /\b(security alert|security notice|suspicious|unusual (activity|login|sign.{0,6}in)|new (personal access )?token|token (created|added|generated)|new ssh key|recovery email changed|password was changed|new sign.{0,6}in|login from a new device)\b/i
const LOGIN_APPROVAL_PATTERN =
  /\b(approve (this )?(sign[-\s]?in|login)|sign[-\s]?in approval|login approval|confirm (this )?(sign[-\s]?in|login)|authorize (this )?(sign[-\s]?in|login))\b/i

const BILLING_PROBLEM_PATTERN =
  /\b(payment failed|failed payment|could not process your payment|billing problem|invoice overdue|past due|card declined|subscription suspended|service interruption|action required.{0,40}(billing|payment|invoice))\b/i
const CALENDAR_INVITE_PATTERN =
  /\b(calendar invitation|invited you to|rsvp|respond to this invitation|accepted:|declined:|tentative:|meeting invitation|\.ics\b|google meet|zoom meeting|has been (canceled|cancelled|rescheduled)|updated invitation|new event:|event invitation)\b/i
const CALENDAR_SENDER_DOMAIN_PATTERN = /^(calendar-notification\.google\.com|calendar\.google\.com|.*\.calendar\.google\.com)$/
const DELIVERY_ISSUE_PATTERN =
  /\b(delivery (delayed|failed|exception|issue)|shipment (delayed|failed)|unable to deliver|package delayed|delivery attempt)\b/i
const LINKEDIN_JOB_ALERT_PATTERN =
  /\b(linkedin job alert|new jobs for|jobs you may be interested in|your job alert)\b/i
const FYI_DONE_PATTERN =
  /\b(no action (is )?(needed|required)|for your records|receipt|payment received|all set|completed successfully|successfully updated|confirmed)\b/i

const RECEIPT_PATTERN =
  /\b(receipt|order confirmation|order #?\w+|payment received|paid invoice|invoice paid|purchase confirmation|registration (is )?complete)\b/i

const SALES_OUTREACH_CTA_PATTERN =
  /\b(book (a |your )?(time|call|consultation)|schedule (a |your )?(call|consultation|strategy session)|reserve (a |your )?(time|spot))\b/i
const SALES_OUTREACH_OFFER_PATTERN =
  /\b(career strategy|career (advice|coaching)|complimentary (call|consultation|session)|free consultation|exploring careers? in|strategy call)\b/i

const IMAGE_TAG_PATTERN = /<img\b[^>]*>/gi
const IMAGE_PROMO_PATTERN =
  /\b(flowers?|bouquets?|gifts? for (her|him|mom|dad)|shop (flowers?|bouquets?|gifts?)|special day|mother'?s day|father'?s day|valentine'?s day)\b/i

// Promotional / commercial intent = "Marketing" (Inbox Zero's definition:
// "Promotional emails about products, services, sales, or offers"). Kept
// high-precision — commercial phrases only, not bare words like "sale" or
// "don't miss" — so a personal email mentioning a garage sale isn't swept in.
const MARKETING_PATTERN =
  /\b(\d+%\s*off|% off|\$\d+\s*off|save (up to|\$\d)|discount code|coupon|promo code|voucher|clearance|flash sale|door ?buster|black friday|cyber monday|prime day|bogo|buy one get|free shipping|free trial|exclusive (offer|deal|discount|savings)|special offer|limited[- ]time offer|deal of the (day|week)|sale ends|on sale now|new arrivals|back in stock|shop (now|the)|order now|buy now|add to cart|upgrade (now|today)|gift (guide|card)|today only|while supplies last)\b/i

// Editorial / subscribed content = "Newsletter" (Inbox Zero's definition:
// "Regular content from publications, blogs, or services I've subscribed to").
const NEWSLETTER_EDITORIAL_PATTERN =
  /\b(in this (issue|edition|newsletter)|this week'?s?\s|weekly (digest|roundup|recap|newsletter|update|brief|edition)|daily (digest|briefing|brief|newsletter|edition)|monthly (newsletter|roundup|recap|digest)|read (the full|more online|online|the rest)|\d+\s*min(ute)? read|latest (posts?|articles?|stories|issue|edition)|new (post|article|episode)|top stories|what you missed|in case you missed|catch up on|curated|round[- ]?up|editor'?s?[- ]?(note|pick|letter)|issue #?\s?\d+|edition #?\s?\d+)\b/i

// Generic bulk-list markers present in most list mail — newsletters AND
// marketing. Used only as a last-resort "this is bulk list mail, file it as
// newsletter" AFTER the promotional and editorial checks, because marketing
// mail carries these (legally required) footers too. Checking this first — as
// the classifier used to — mislabeled every sale/offer email as a newsletter.
export const BULK_LIST_PATTERN =
  /\b(unsubscribe|manage (your )?(email )?(preferences|subscription)|update your (email )?preferences|email preferences|if you no longer wish to receive|to stop receiving (these|this)|you('re| are) receiving this (email )?because|opt.out|view (this email )?in (your )?browser|do not reply to this email|this is an automated)\b/i

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
  extras: Pick<EmailClassifierResult, "extractedCode" | "expiresIn" | "action"> = {}
): EmailClassifierResult {
  return { emailType, attentionCategory, reason, confidence, ...extras }
}

function combinedText(subject: string, body: string): string {
  return `${subject}\n${body}`.trim()
}

const HTML_KEYWORD_BLOCKLIST = new Set([
  "html", "body", "head", "style", "script", "doctype", "doctypehtml",
  "div", "span", "table", "tbody", "thead", "tfoot", "tr", "td", "th",
  "img", "href", "src", "class", "type", "meta", "link", "input",
  "form", "button", "select", "option", "label", "nav", "header",
  "footer", "main", "section", "article", "aside", "figure",
])

function stripHtmlForCodeExtraction(text: string): string {
  return text
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<!DOCTYPE[^>]*>/gi, " ")
    .replace(/<[^>]{0,500}>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}

function isValidCode(raw: string): boolean {
  const code = raw.replace(/\s|-/g, "").toLowerCase()
  if (HTML_KEYWORD_BLOCKLIST.has(code)) return false
  if (code.length < 4) return false
  // All digits: classic numeric OTP
  if (/^\d+$/.test(code)) return code.length >= 4 && code.length <= 8
  // Mixed alphanumeric must contain at least one digit (rules out English words like "Security")
  if (/\d/.test(code) && /^[a-z0-9]+$/.test(code)) return code.length >= 4 && code.length <= 12
  return false
}

function extractVerificationCode(rawText: string): string | undefined {
  const text = stripHtmlForCodeExtraction(rawText)

  // 1. Look for explicit "code is/: VALUE" phrase
  const afterPhrase = text.match(
    /\b(?:verification|security|authentication|login|access|2fa|mfa|one[-\s]?time)?\s*(?:code|passcode|password|pin|otp)\s+(?:is|:)\s*([A-Z0-9][A-Z0-9 -]{3,14}[A-Z0-9])\b/i
  )
  if (afterPhrase?.[1] && isValidCode(afterPhrase[1])) {
    return afterPhrase[1].replace(/\s|-/g, "")
  }

  // 2. Find numeric sequences (4-8 digits) — most common OTP format
  for (const m of text.matchAll(/\b(\d{4,8})\b/g)) {
    if (isValidCode(m[1])) return m[1]
  }

  // 3. Alphanumeric codes must be near a keyword to avoid false positives
  const alphanumMatch = text.match(
    /\b(?:code|otp|passcode|pin)\b[^.]{0,40}?\b([A-Z0-9]{3,4}[-\s]?[A-Z0-9]{3,4})\b/i
  )
  if (alphanumMatch?.[1] && isValidCode(alphanumMatch[1])) {
    return alphanumMatch[1].replace(/\s|-/g, "")
  }

  return undefined
}

function extractExpiry(text: string): string | undefined {
  const match = text.match(EXPIRES_PATTERN)
  return match?.[1]?.replace(/\s+/g, " ")
}

const DISCARD_URL_PATTERNS = [
  /unsubscribe/i,
  /\bunsub\b/i,
  /opt[_-]?out/i,
  /\/pixel[/?]/i,
  /\/track[/?]/i,
  /[?&]utm_/i,
  /\/open[/?]/i,
  /\/click[/?]/i,
  /linkedin\.com/i,
  /twitter\.com/i,
  /facebook\.com/i,
  /instagram\.com/i,
]

const CTA_ACTION_KEYWORDS = [
  "reset", "verify", "confirm", "activate", "create-password",
  "set-password", "choose-password", "signup", "sign-up", "magic",
  "token", "validate", "complete", "account/setup", "account/confirm",
  "approve", "authorize",
]

const CTA_TYPE_KEYWORDS: Record<string, string[]> = {
  reset_password: ["reset", "password"],
  create_password: ["create-password", "set-password", "choose-password"],
  verify_email: ["verify", "confirm", "validate", "activate"],
  confirm_account: ["confirm", "activate", "complete"],
  account_setup: ["setup", "activate", "complete"],
  login_approval: ["approve", "authorize", "login", "signin"],
  magic_link: ["magic", "login", "signin"],
  security_alert: ["review", "revoke", "secure", "account"],
}

function extractBestActionLink(text: string, actionType?: string): string | undefined {
  const allUrls = Array.from(text.matchAll(/\bhttps?:\/\/[^\s<>"')]+/gi))
    .map((m) => m[0].replace(/[.,;:!?]+$/, ""))
    .filter((url) => url.length >= 20)

  const candidates = allUrls.filter(
    (url) => !DISCARD_URL_PATTERNS.some((p) => p.test(url))
  )

  if (candidates.length === 0) return undefined
  if (candidates.length === 1) return candidates[0]

  const typeKeywords = actionType ? (CTA_TYPE_KEYWORDS[actionType] ?? []) : []

  const scored = candidates.map((url) => {
    const lower = url.toLowerCase()
    let score = 0
    if (typeKeywords.some((k) => lower.includes(k))) score += 3
    if (CTA_ACTION_KEYWORDS.some((k) => lower.includes(k))) score += 2
    const pathOnly = lower.split("?")[0]
    if (pathOnly.length > 40) score += 1
    return { url, score }
  })

  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]

  // If no candidate has any CTA signal, don't surface an unknown link
  if (best.score === 0) return undefined

  return best.url
}

function passwordActionType(text: string): ActionType {
  if (/\b(reset your password|password reset)\b/i.test(text)) return "reset_password"
  if (/\b(create (a )?password|set up (a )?password|choose (a )?password)\b/i.test(text)) return "create_password"
  return "account_setup"
}

function verificationActionType(text: string): ActionType {
  if (/\bconfirm your (email|account)\b/i.test(text)) return "confirm_account"
  if (/\b(activate your account|complete your account setup|finish setting up your account)\b/i.test(text)) return "account_setup"
  return "verify_email"
}

export function classifyEmailType(input: EmailClassifierInput): EmailClassifierResult {
  const { subject, body } = input
  const text = combinedText(subject, body)
  const domain = extractDomain(input.fromEmail)
  const localPart = extractLocalPart(input.fromEmail)

  if (OTP_PATTERN.test(text)) {
    const extractedCode = extractVerificationCode(text)
    const expiresIn = extractExpiry(text)
    return result("notification", "needs_action", "Verification code requires user action.", 0.95, {
      extractedCode,
      expiresIn,
      action: {
        type: "otp_code",
        explanation: "Use the one-time code only in the service that requested it.",
        ...(extractedCode ? { detectedCode: extractedCode } : {}),
        ...(expiresIn ? { expirationText: expiresIn } : {}),
      },
    })
  }

  if (LOGIN_APPROVAL_PATTERN.test(text)) {
    const expiresIn = extractExpiry(text)
    const actionLink = extractBestActionLink(text, "login_approval")
    return result("notification", "needs_action", "Sign-in approval requires user action.", 0.94, {
      expiresIn,
      action: {
        type: "login_approval",
        explanation: "Approve or deny the sign-in request in the originating service.",
        ...(actionLink ? { actionLink } : {}),
        ...(expiresIn ? { expirationText: expiresIn } : {}),
      },
    })
  }

  if (PASSWORD_ACTION_PATTERN.test(text)) {
    const expiresIn = extractExpiry(text)
    const type = passwordActionType(text)
    const actionLink = extractBestActionLink(text, type)
    return result("notification", "needs_action", "Password setup or reset link requires user action.", 0.94, {
      expiresIn,
      action: {
        type,
        explanation: type === "reset_password" ? "Reset the password if you requested it." : "Create or set up the account password.",
        ...(actionLink ? { actionLink } : {}),
        ...(expiresIn ? { expirationText: expiresIn } : {}),
      },
    })
  }

  if (VERIFY_ACCOUNT_PATTERN.test(text)) {
    const expiresIn = extractExpiry(text)
    const type = verificationActionType(text)
    const actionLink = extractBestActionLink(text, type)
    return result("notification", "needs_action", "Account verification or setup requires user action.", 0.93, {
      expiresIn,
      action: {
        type,
        explanation: "Verify or confirm the account action in the originating service.",
        ...(actionLink ? { actionLink } : {}),
        ...(expiresIn ? { expirationText: expiresIn } : {}),
      },
    })
  }

  if (CALENDAR_INVITE_PATTERN.test(text) || CALENDAR_SENDER_DOMAIN_PATTERN.test(domain)) {
    return result("calendar", "needs_action", "Calendar invite or RSVP requires a user decision.", 0.9)
  }

  if (SECURITY_REVIEW_PATTERN.test(text)) {
    return result("notification", "review_soon", "Security-sensitive account alert should be reviewed soon.", 0.93, {
      action: {
        type: "security_alert",
        explanation: "Review the security alert and take action only if the activity was not yours.",
        ...(extractBestActionLink(text, "security_alert") ? { actionLink: extractBestActionLink(text, "security_alert") } : {}),
      },
    })
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

  // Completed transactions take precedence over cross-sell copy commonly
  // appended to receipts and order confirmations.
  if (RECEIPT_PATTERN.test(text)) {
    return result("notification", "fyi_done", "Completed order or payment receipt.", 0.9)
  }

  // ---- Content-type classification ----
  // Ordering is deliberate: promotional intent (marketing) is checked BEFORE
  // any "has an unsubscribe link -> newsletter" signal and before the
  // sender-domain rules, because (1) virtually all marketing mail carries a
  // legally-required unsubscribe link, and (2) marketing/newsletter mail is
  // often sent from email-service-provider or e-commerce domains. Deciding on
  // sender or on the bulk-list footer first mislabeled sale/offer emails as
  // newsletters and ESP-sent mail as notifications.

  // 1. Promotional / sales content -> Marketing.
  if (MARKETING_PATTERN.test(text)) {
    return result("marketing", "quiet", "Promotional or sales email.", 0.85)
  }

  // Image-led retail campaigns can contain almost no visible text. Require
  // multiple image tags plus commercial context so ordinary HTML signatures
  // and personal photo messages are not swept into Marketing.
  const imageCount = body.match(IMAGE_TAG_PATTERN)?.length ?? 0
  if (imageCount >= 2 && IMAGE_PROMO_PATTERN.test(text)) {
    return result("marketing", "quiet", "Image-heavy retail promotion.", 0.84)
  }

  // One-way lead-generation mail often avoids discount language but still has
  // a sales CTA. Both an offer and booking CTA are required to protect genuine
  // human scheduling requests.
  if (SALES_OUTREACH_CTA_PATTERN.test(text) && SALES_OUTREACH_OFFER_PATTERN.test(text)) {
    return result("marketing", "quiet", "One-way promotional outreach with a booking call to action.", 0.82)
  }

  // 2. Editorial / subscribed content -> Newsletter.
  if (NEWSLETTER_EDITORIAL_PATTERN.test(text)) {
    return result("newsletter", "read_later", "Newsletter or editorial content the user may want to read later.", 0.82)
  }

  // 3. Known automated product/transactional notification senders.
  if (
    NOTIFICATION_DOMAINS.has(domain) ||
    GOOGLE_NOTIFICATION_DOMAIN_PATTERN.test(domain) ||
    MICROSOFT_NOTIFICATION_DOMAIN_PATTERN.test(domain)
  ) {
    return result("notification", "fyi_done", "Known automated notification sender.", 0.78)
  }

  // 4. Subject/body notification patterns (product, workflow, account activity).
  if (NOTIFICATION_SUBJECT_PATTERN.test(subject)) {
    return result("notification", "fyi_done", "Automated product or workflow notification.", 0.78)
  }
  if (NOTIFICATION_BODY_PATTERN.test(body)) {
    return result("notification", "fyi_done", "Automated account notification with no detected action.", 0.76)
  }

  // 5. No-reply / automated local part with no promo, editorial, or product
  //    signal -> a bare automated notification (e.g. a transactional receipt).
  if (NO_REPLY_LOCAL_PATTERN.test(localPart)) {
    return result("notification", "fyi_done", "Automated no-reply notification with no detected action.", 0.75)
  }

  // 6. Sender-subdomain hints (weak; only reached when content didn't decide).
  if (MARKETING_SUBDOMAIN_PATTERN.test(domain)) {
    return result("marketing", "quiet", "Marketing or campaign sender subdomain.", 0.7)
  }
  if (NEWSLETTER_SUBDOMAIN_PATTERN.test(domain)) {
    return result("newsletter", "read_later", "Newsletter sender subdomain.", 0.7)
  }

  // 7. Generic bulk-list markers with no stronger signal -> Newsletter (soft).
  if (BULK_LIST_PATTERN.test(body)) {
    return result("newsletter", "read_later", "Bulk list email the user may want to read later.", 0.72)
  }

  if (FYI_DONE_PATTERN.test(text)) {
    return result("fyi", "fyi_done", "Informational email appears complete with no action required.", 0.72)
  }

  return result("needs_reply", "needs_reply", "Human message likely expects a reply.", 0.7)
}
