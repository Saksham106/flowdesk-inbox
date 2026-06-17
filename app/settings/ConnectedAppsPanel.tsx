"use client"
import { useState } from "react"

export default function ConnectedAppsPanel({
  driveConnected,
  driveEmail,
}: {
  driveConnected: boolean
  driveEmail?: string
}) {
  const [disconnecting, setDisconnecting] = useState(false)

  async function disconnect() {
    setDisconnecting(true)
    await fetch("/api/integrations/google-drive/disconnect", { method: "DELETE" })
    window.location.reload()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100">
            <svg className="h-4 w-4 text-blue-600" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6.28 3L1 12l5.28 9h11.44L23 12 17.72 3H6.28zM12 16.5L8.5 10.5h7L12 16.5z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-800">Google Drive</p>
            <p className="text-xs text-slate-500">
              {driveConnected
                ? `Connected as ${driveEmail}`
                : "Pull document context when drafting replies"}
            </p>
          </div>
        </div>
        {driveConnected ? (
          <button
            onClick={disconnect}
            disabled={disconnecting}
            className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
          >
            {disconnecting ? "..." : "Disconnect"}
          </button>
        ) : (
          <a
            href="/api/integrations/google-drive/connect"
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
          >
            Connect
          </a>
        )}
      </div>
      <p className="text-xs text-slate-400">
        More integrations (Notion, Slack, Calendly) coming soon.
      </p>
    </div>
  )
}
