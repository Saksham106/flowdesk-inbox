"use client"
import { useState } from "react"

type Snippet = { id: string; title: string; content: string; status: string; source: string; useCount: number }

export default function SnippetsPanel({ initialSnippets }: { initialSnippets: Snippet[] }) {
  const [snippets, setSnippets] = useState(initialSnippets)
  const [newTitle, setNewTitle] = useState("")
  const [newContent, setNewContent] = useState("")
  const [adding, setAdding] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const suggested = snippets.filter((s) => s.status === "suggested")
  const active = snippets.filter((s) => s.status === "active")

  async function act(id: string, status: string) {
    await fetch(`/api/snippets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    setSnippets((prev) =>
      status === "dismissed" ? prev.filter((s) => s.id !== id) : prev.map((s) => s.id === id ? { ...s, status } : s)
    )
  }

  async function handleAdd() {
    if (!newTitle.trim() || !newContent.trim()) return
    setAdding(true)
    const res = await fetch("/api/snippets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle, content: newContent }),
    })
    const data = await res.json()
    if (res.ok) {
      setSnippets((prev) => [...prev, data.snippet])
      setNewTitle("")
      setNewContent("")
      setShowForm(false)
    }
    setAdding(false)
  }

  return (
    <div className="space-y-4">
      {suggested.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Suggested snippets</p>
          <div className="space-y-2">
            {suggested.map((s) => (
              <div key={s.id} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-sm font-medium text-slate-900">{s.title}</p>
                <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">{s.content}</p>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => act(s.id, "active")} className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700">Approve</button>
                  <button onClick={() => act(s.id, "dismissed")} className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">Dismiss</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {active.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Active snippets ({active.length})</p>
          <div className="space-y-1">
            {active.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2.5">
                <div>
                  <p className="text-sm font-medium text-slate-700">{s.title}</p>
                  <p className="text-xs text-slate-400 line-clamp-1">{s.content}</p>
                </div>
                <button onClick={() => act(s.id, "dismissed")} className="shrink-0 text-xs text-slate-400 hover:text-red-500 ml-4">Remove</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showForm ? (
        <div className="rounded-lg border border-slate-200 p-4 space-y-3">
          <input
            type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Snippet title"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
          <textarea
            value={newContent} onChange={(e) => setNewContent(e.target.value)}
            placeholder="Snippet content"
            rows={3}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={adding} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50">
              {adding ? "Saving…" : "Add snippet"}
            </button>
            <button onClick={() => setShowForm(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowForm(true)} className="text-sm font-medium text-slate-600 hover:text-slate-900">
          + Add manual snippet
        </button>
      )}
    </div>
  )
}
