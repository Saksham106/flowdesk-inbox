// Which Channel.provider values FlowDesk can write back into (labels/archive/
// read-state/drafts land in the user's own mailbox). Deliberately free of
// heavy imports: consumed by hot paths (label projection) that must not pull
// googleapis or the Graph client into their static import graph.
export const MAILBOX_WRITEBACK_PROVIDERS: ReadonlySet<string> = new Set(["google", "microsoft"])

export function supportsMailboxWriteback(provider: string | null | undefined): boolean {
  return !!provider && MAILBOX_WRITEBACK_PROVIDERS.has(provider)
}

// Audit trail namespace per provider — gmail.* names predate Outlook parity
// and must stay stable for existing dashboards/history.
export function auditPrefixForProvider(provider: string): "gmail" | "outlook" {
  if (provider === "google") return "gmail"
  if (provider === "microsoft") return "outlook"
  throw new Error(`No mailbox writeback support for provider: ${provider}`)
}
