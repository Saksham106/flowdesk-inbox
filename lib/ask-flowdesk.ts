/**
 * Selector for the global "Ask FlowDesk" trigger (see the rail button in
 * app/components/AppRail.tsx). Shared between the trigger and the slide-over
 * panel's document-level click listener so the two never drift apart.
 */
export const ASK_FLOWDESK_SELECTOR = "[data-ask-flowdesk]"

/**
 * True if a click event's target is, or is inside, an Ask FlowDesk trigger.
 * Takes a minimal duck-typed shape (rather than the full `EventTarget`) so
 * this stays pure and unit-testable without a DOM environment.
 */
export function isAskFlowDeskClick(target: { closest(selector: string): unknown } | null): boolean {
  if (!target) return false
  return target.closest(ASK_FLOWDESK_SELECTOR) != null
}
