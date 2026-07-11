import { BULK_LIST_PATTERN } from "@/lib/agent/email-classifier"
import { extractListUnsubscribeHeader } from "@/lib/agent/unsubscribe"

export function hasBulkMailSignals(input: { body: string; rawHeaders?: string }): boolean {
  if (BULK_LIST_PATTERN.test(input.body)) return true
  if (input.rawHeaders && extractListUnsubscribeHeader(input.rawHeaders)) return true
  return false
}
