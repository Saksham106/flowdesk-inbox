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

/**
 * CSS selector for focusable descendants used by the dialog focus trap.
 */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Pure focus-trap wrap logic. Given the ordered list of focusable elements
 * inside the dialog, the currently-focused element, and whether Shift is
 * held, returns the element that focus should wrap to — or `null` when the
 * browser's default Tab behavior is fine (i.e. no wrap needed).
 *
 * - Tab on the last element → wrap to the first.
 * - Shift+Tab on the first element → wrap to the last.
 * - Focus currently outside the trap (e.g. on the panel container) → pull it
 *   back to the first (Tab) or last (Shift+Tab) element.
 *
 * Kept DOM-agnostic (works on any array + identity comparison) so it can be
 * unit-tested without a browser environment.
 */
export function focusTrapTarget<T>(
  focusable: T[],
  active: T | null,
  shift: boolean
): T | null {
  if (focusable.length === 0) return null
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const index = active == null ? -1 : focusable.indexOf(active)

  if (shift) {
    if (index <= 0) return last
    return null
  }
  if (index === -1 || index === focusable.length - 1) return first
  return null
}
