export type PhishingVerdict = "safe" | "suspicious" | "likely_phishing"

export type PhishingResult = {
  verdict: PhishingVerdict
  score: number
  signals: string[]
}

const LEGITIMATE_DOMAINS: Record<string, string> = {
  paypal: "paypal.com",
  apple: "apple.com",
  google: "google.com",
  microsoft: "microsoft.com",
  amazon: "amazon.com",
  netflix: "netflix.com",
  irs: "irs.gov",
  "social security": "ssa.gov",
  medicare: "medicare.gov",
  chase: "chase.com",
  "bank of america": "bankofamerica.com",
  citibank: "citibank.com",
  wellsfargo: "wellsfargo.com",
}

const HOMOGLYPHS: Record<string, string> = {
  "0": "o",
  "1": "l",
  "3": "e",
  "4": "a",
  "5": "s",
  "@": "a",
  "rn": "m",
}

const SUSPICIOUS_TLDS = new Set([".xyz", ".top", ".click", ".loan", ".win", ".work", ".gq", ".tk", ".ml", ".ga", ".cf"])

const URGENCY_PATTERN =
  /\b(immediately|urgent|asap|right now|within 24 hours|within 48 hours|account (suspended|locked|closed|compromised)|verify now|act now|final warning)\b/i

const SCAM_PHRASES =
  /\b(you have won|send gift cards?|wire transfer|western union|moneygram|bitcoin wallet|you('ve| have) been selected|claim your (prize|reward|gift))\b/i

const IMPERSONATION_NAMES =
  /\b(irs|internal revenue|federal bureau|fbi|social security|ssa|paypal|apple id|google account|microsoft support|amazon support|netflix|bank of america|citibank|wells fargo|chase bank|medicare|medicaid)\b/i

function extractDomain(email: string): string {
  const match = email.match(/@([^>\s]+)/)
  return match ? match[1].toLowerCase().trim() : ""
}

function isLookalikeOf(domain: string, brand: string): boolean {
  // First check if domain already looks like a homoglyph variant
  let normalized = domain
  for (const [glyph, real] of Object.entries(HOMOGLYPHS)) {
    normalized = normalized.split(glyph).join(real)
  }
  // If after normalization, it's similar to the brand but not exactly the legitimate domain
  if (normalized.includes(brand)) {
    const legitimateDomain = brand + ".com"
    const legitimateDomainGov = brand + ".gov"
    if (domain !== legitimateDomain && domain !== legitimateDomainGov) {
      return true
    }
  }
  return false
}

export function detectPhishing(
  fromHeader: string,
  replyTo: string,
  subject: string,
  body: string
): PhishingResult {
  const signals: string[] = []
  let score = 0
  const text = `${subject}\n${body}`
  const fromDomain = extractDomain(fromHeader)
  const replyToDomain = extractDomain(replyTo)

  // Signal: mismatched reply-to vs from domain
  if (replyToDomain && fromDomain && replyToDomain !== fromDomain) {
    signals.push("mismatched_reply_to")
    score += 25
  }

  // Signal: lookalike domain (homoglyphs)
  for (const brand of Object.keys(LEGITIMATE_DOMAINS)) {
    if (isLookalikeOf(fromDomain, brand.replace(/\s/g, ""))) {
      signals.push("lookalike_domain")
      score += 40
      break
    }
  }

  // Signal: suspicious TLD
  for (const tld of SUSPICIOUS_TLDS) {
    if (fromDomain.endsWith(tld)) {
      signals.push("suspicious_tld")
      score += 20
      break
    }
  }

  // Signal: impersonation name in from header but not on legitimate domain
  const impersonationMatch = fromHeader.match(IMPERSONATION_NAMES)
  if (impersonationMatch) {
    const brand = impersonationMatch[0].toLowerCase().replace(/\s/g, "")
    const legitimateDomain = Object.entries(LEGITIMATE_DOMAINS).find(([k]) =>
      k.replace(/\s/g, "") === brand
    )?.[1]
    if (legitimateDomain && !fromDomain.endsWith(legitimateDomain)) {
      signals.push("impersonation")
      score += 35
    }
  }

  // Signal: urgency + account language
  if (URGENCY_PATTERN.test(text)) {
    signals.push("urgency_language")
    score += 15
  }

  // Signal: known scam phrases
  if (SCAM_PHRASES.test(text)) {
    signals.push("scam_phrase")
    score += 35
  }

  const verdict: PhishingVerdict =
    score >= 70 ? "likely_phishing" : score >= 30 ? "suspicious" : "safe"

  return { verdict, score, signals }
}
