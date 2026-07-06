import { prisma } from "@/lib/prisma"

/**
 * Automation trust ladder (Phase D foundation).
 *
 * The per-tenant automation level is a CEILING mapped onto the existing gate
 * chain — it never replaces or loosens a gate. An action runs only when the
 * level allows it AND every pre-existing gate (policy, confidence thresholds,
 * allow-lists, budget, daily caps, failure auto-disable, learned profile)
 * also passes. User-initiated actions (clicking Send, archiving a thread,
 * changing a workflow status by hand) are not automation and are never gated
 * by the level.
 *
 * Level definitions (docs/product-direction.md "Automation levels"):
 *
 * | Level | Meaning                        | Gmail labels | Gmail drafts | Auto mark-read/archive | Auto-send |
 * |-------|--------------------------------|--------------|--------------|------------------------|-----------|
 * | 0     | Read-only insights             | no           | no           | no                     | no        |
 * | 1     | Suggest in dashboard only      | no           | no           | no                     | no        |
 * | 2     | Apply labels in Gmail (default)| yes          | no           | no                     | no        |
 * | 3     | Create Gmail drafts            | yes          | yes          | no                     | no        |
 * | 4     | Mark low-risk read / archive   | yes          | yes          | yes                    | no        |
 * | 5     | Auto-send approved categories  | yes          | yes          | yes                    | yes*      |
 *
 * *Auto-send at Level 5 still requires autopilot enabled + every existing
 * confidence/policy/budget/cap gate. Levels 0-4 can never auto-send.
 * (No automatic mark-read/archive path exists yet; the Level 4 gate is wired
 * here so future callers inherit it.)
 */

export const AUTOMATION_LEVEL_MIN = 0
export const AUTOMATION_LEVEL_MAX = 5

/** Default for new tenants (plan recommendation: start at "organize Gmail"). */
export const AUTOMATION_LEVEL_DEFAULT = 2

export type AutomationAction =
  | "apply_gmail_labels"
  | "create_gmail_drafts"
  | "auto_mark_read"
  | "auto_archive"
  | "auto_send"

export const MIN_LEVEL_FOR_ACTION: Record<AutomationAction, number> = {
  apply_gmail_labels: 2,
  create_gmail_drafts: 3,
  auto_mark_read: 4,
  auto_archive: 4,
  auto_send: 5,
}

export function isActionAllowedAtLevel(level: number, action: AutomationAction): boolean {
  return level >= MIN_LEVEL_FOR_ACTION[action]
}

export function clampAutomationLevel(value: number): number {
  if (!Number.isFinite(value)) return AUTOMATION_LEVEL_MIN
  return Math.min(AUTOMATION_LEVEL_MAX, Math.max(AUTOMATION_LEVEL_MIN, Math.trunc(value)))
}

/**
 * Level for tenants that predate the ladder (mirrors the backfill in
 * migration 20260706120000): autopilot enabled means auto-send was already
 * configured (Level 5 — every other gate still applies); everyone else gets
 * Level 3, because label projection and Gmail drafts shipped unconditionally
 * in Phases A/B. Never increases effective autonomy.
 */
export function deriveAutomationLevelFromLegacySettings(
  setting: { enabled: boolean } | null
): number {
  return setting?.enabled ? 5 : 3
}

/**
 * Current automation level for a tenant. A missing row means the tenant
 * predates both the ladder and the signup-time AutopilotSetting creation, so
 * legacy derivation applies rather than the new-tenant default.
 */
export async function getAutomationLevel(tenantId: string): Promise<number> {
  const setting = await prisma.autopilotSetting.findUnique({
    where: { tenantId },
    select: { automationLevel: true },
  })
  if (!setting) return deriveAutomationLevelFromLegacySettings(null)
  return clampAutomationLevel(setting.automationLevel)
}
