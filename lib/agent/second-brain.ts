export type ExtractedFact = {
  key: string
  value: string
  confidence: "high" | "medium"
}

const BIRTHDAY_PATTERN =
  /\b(?:my |our )?(birthday|born|birth date|dob)\b.*?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?/i

const DIETARY_PATTERN =
  /\b(vegetarian|vegan|gluten.free|dairy.free|nut.free|kosher|halal|lactose.intolerant|pescatarian|celiac)\b/i

const ROLE_PATTERN =
  /\b(?:i(?:'m| am) (?:the )?)?(ceo|cto|cfo|coo|vp|vice president|director|head of|manager|founder|co-founder|president|partner|principal|lead)\b[^.\n]*?(?:at|of|@)\s+([A-Z][A-Za-z0-9\s&,.'-]{2,40})/i

const COMPANY_PATTERN =
  /\b(?:i(?:'m| am) )?(?:from|at|with|working (?:at|for)|employed (?:at|by))\s+([A-Z][A-Za-z0-9\s&,.'-]{2,40})\b/

const PHONE_PATTERN =
  /(?:my (?:cell|mobile|phone|number) is\s*)(\+?[\d\s\-().]{10,20})/i

export function extractFacts(
  contactName: string,
  subject: string,
  body: string
): ExtractedFact[] {
  const facts: ExtractedFact[] = []
  const text = `${subject}\n${body}`

  const birthdayMatch = text.match(BIRTHDAY_PATTERN)
  if (birthdayMatch) {
    facts.push({ key: "birthday", value: birthdayMatch[0].trim(), confidence: "medium" })
  }

  const dietaryMatch = text.match(DIETARY_PATTERN)
  if (dietaryMatch) {
    facts.push({ key: "dietary", value: dietaryMatch[0], confidence: "high" })
  }

  const roleMatch = text.match(ROLE_PATTERN)
  if (roleMatch) {
    facts.push({ key: "role", value: roleMatch[0].trim(), confidence: "high" })
  } else {
    const companyMatch = text.match(COMPANY_PATTERN)
    if (companyMatch) {
      facts.push({ key: "company", value: companyMatch[1].trim(), confidence: "medium" })
    }
  }

  const phoneMatch = text.match(PHONE_PATTERN)
  if (phoneMatch) {
    facts.push({ key: "phone", value: phoneMatch[1].trim(), confidence: "high" })
  }

  return facts
}

export function mergeFacts(
  existing: ExtractedFact[],
  incoming: ExtractedFact[]
): ExtractedFact[] {
  const map = new Map<string, ExtractedFact>()
  for (const f of existing) map.set(f.key, f)
  for (const f of incoming) {
    if (!map.has(f.key) || f.confidence === "high") {
      map.set(f.key, f)
    }
  }
  return Array.from(map.values())
}
