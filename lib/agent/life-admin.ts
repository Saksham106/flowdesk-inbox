export type LifeAdminType =
  | "bill_due"
  | "travel_confirmation"
  | "medical_appointment"
  | "subscription_renewal"
  | "school_notice"

export type LifeAdminResult = {
  type: LifeAdminType | null
  amount?: number
  currency?: string
}

const BILL_PATTERN =
  /\b(bill|invoice|payment due|amount due|balance due|statement|past due|pay by|due (on|date))\b/i
const TRAVEL_PATTERN =
  /\b(flight|confirmation|booking|reservation|itinerary|hotel|check-in|departure|arrival|boarding pass|e-ticket)\b/i
const MEDICAL_PATTERN =
  /\b(appointment|dr\.|doctor|clinic|hospital|dental|vision|therapy|telehealth|patient)\b/i
const SUBSCRIPTION_PATTERN =
  /\b(subscription|renews?|renewal|auto.renew|next billing|your plan|membership renews?)\b/i
const SCHOOL_PATTERN =
  /\b(grade|report card|transcript|enrollment|tuition|semester|course|academic|school|university|college|student)\b/i

const AMOUNT_PATTERN = /\$\s*([\d,]+(?:\.\d{2})?)/

function extractAmount(text: string): { amount?: number; currency?: string } {
  const match = text.match(AMOUNT_PATTERN)
  if (!match) return {}
  const amount = parseFloat(match[1].replace(/,/g, ""))
  return isNaN(amount) ? {} : { amount, currency: "USD" }
}

export function detectLifeAdminType(
  _fromEmail: string,
  subject: string,
  body: string
): LifeAdminResult {
  const text = `${subject}\n${body}`

  if (BILL_PATTERN.test(text) && AMOUNT_PATTERN.test(text)) {
    return { type: "bill_due", ...extractAmount(text) }
  }
  if (TRAVEL_PATTERN.test(text)) {
    return { type: "travel_confirmation" }
  }
  if (MEDICAL_PATTERN.test(text)) {
    return { type: "medical_appointment" }
  }
  if (SUBSCRIPTION_PATTERN.test(text)) {
    return { type: "subscription_renewal", ...extractAmount(text) }
  }
  if (SCHOOL_PATTERN.test(text)) {
    return { type: "school_notice" }
  }
  return { type: null }
}
