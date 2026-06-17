"use client"

import type React from "react"
import { useState } from "react"
import { useRouter } from "next/navigation"
import type { CommandCenterConversation } from "@/lib/agent/command-center"

const ACTION_TYPE_LABELS: Record<string, string> = {
  otp_code: "Code detected",
  otp: "Code detected",
  verification_code: "Code detected",
  login_approval: "Login approval",
  reset_password: "Password reset",
  password_reset: "Password reset",
  create_password: "Create password",
  verify_email: "Email verification",
  email_verification: "Email verification",
  confirm_account: "Confirm account",
  account_setup: "Account setup",
  security_alert: "Security alert",
  magic_link: "Login link",
  action_required: "Action required",
}

function actionLabel(type: string): string {
  return ACTION_TYPE_LABELS[type] ?? type.replace(/_/g, " ")
}

interface Props {
  items: CommandCenterConversation[]
  excludeIds?: Set<string>
}

function NeedsActionCard({ item }: { item: CommandCenterConversation }) {
  const router = useRouter()
  const action = item.action
  const [copied, setCopied] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const [dismissError, setDismissError] = useState<string | null>(null)

  if (dismissed) return null

  function openCard() {
    router.push(item.href)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      openCard()
    }
  }

  function copyCode(event: React.MouseEvent, code: string) {
    event.stopPropagation()
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 500)
    })
  }

  async function dismissAction(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    setDismissing(true)
    setDismissError(null)
    try {
      const res = await fetch(`/api/conversations/${item.id}/attention`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attentionCategory: "fyi_done" }),
      })
      if (!res.ok) throw new Error("Dismiss failed")
      setDismissed(true)
      router.refresh()
    } catch {
      setDismissError("Couldn't dismiss")
    } finally {
      setDismissing(false)
    }
  }

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={openCard}
      onKeyDown={handleKeyDown}
      aria-label={`Open ${item.displayName}`}
      className={`cursor-pointer flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-2.5 transition hover:bg-amber-50 hover:border-amber-300 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-400 ${item.isRead ? "" : "ring-1 ring-amber-200"}`}
    >
      <div className="flex-1 min-w-0">
        <p className={`text-[11px] text-amber-900 ${item.isRead ? "font-medium" : "font-semibold"}`}>
          {item.displayName}
        </p>
        <p className="text-[11px] text-amber-800 truncate">{item.nextAction}</p>
        {item.reason && (
          <p className="text-[10px] text-amber-600 italic mt-0.5 truncate">{item.reason}</p>
        )}

        {/* Action metadata */}
        {action && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {action.detectedCode ? (
              <>
                <span className="font-mono text-sm bg-violet-50 border border-violet-200 text-violet-900 px-2 py-0.5 rounded">
                  {action.detectedCode}
                </span>
                <button
                  type="button"
                  onClick={(e) => copyCode(e, action.detectedCode!)}
                  title="Copy code"
                  className="text-[10px] font-semibold text-violet-700 hover:text-violet-900 transition"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </>
            ) : action.hasDetectedCode ? (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                Code detected
              </span>
            ) : (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-200 text-amber-800">
                {actionLabel(action.type)}
              </span>
            )}
            {action.expirationText && (
              <span className="text-[10px] text-red-600 font-medium">⏱ {action.expirationText}</span>
            )}
            {action.actionLink && (
              <a
                href={action.actionLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
                title="Open link"
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-600 text-white hover:bg-amber-700 transition"
              >
                Open link →
              </a>
            )}
          </div>
        )}
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={dismissAction}
            disabled={dismissing}
            title="Dismiss"
            className="text-[10px] font-semibold px-2 py-1 rounded-md border border-amber-300 bg-white/70 text-amber-800 transition hover:bg-white disabled:opacity-60"
          >
            {dismissing ? "Saving..." : "Not needed"}
          </button>
          {dismissError && <span className="text-[10px] text-red-600">{dismissError}</span>}
        </div>
      </div>
    </div>
  )
}

export default function NeedsActionSection({ items, excludeIds }: Props) {
  // Deduplicate and exclude IDs already shown elsewhere (e.g. Handle First)
  const seen = new Set<string>(excludeIds)
  const deduped = items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })

  if (deduped.length === 0) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-amber-600">
          Needs Action
        </p>
        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
          OTPs · Links · Security
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {deduped.map((item) => (
          <NeedsActionCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  )
}
