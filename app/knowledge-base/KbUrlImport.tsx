"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function KbUrlImport() {
  const router = useRouter()
  const [url, setUrl] = useState("")
  const [title, setTitle] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleImport() {
    if (!url.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/knowledge-documents/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), title: title.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Failed to import page.")
        return
      }
      setUrl("")
      setTitle("")
      router.refresh()
    } catch {
      setError("Network error — please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-800">Import from URL</h2>
      <div className="flex flex-col gap-2">
        <input
          type="url"
          placeholder="https://yoursite.com/faq"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
        />
        <input
          type="text"
          placeholder="Title (optional — auto-detected)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          onClick={handleImport}
          disabled={loading || !url.trim()}
          className="self-start rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {loading ? "Importing…" : "Import page"}
        </button>
      </div>
    </div>
  )
}
