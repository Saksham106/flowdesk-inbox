"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { SOURCE_TYPE_OPTIONS } from "@/lib/knowledge-document-types"

type KbDoc = {
  id: string
  title: string
  content: string
  sourceType: string
  sourceUrl: string | null
  createdAt: string
}

const SOURCE_TYPE_COLORS: Record<string, string> = {
  faq: "bg-blue-50 text-blue-700",
  service: "bg-purple-50 text-purple-700",
  policy: "bg-amber-50 text-amber-700",
  pricing: "bg-green-50 text-green-700",
  prep_instructions: "bg-teal-50 text-teal-700",
  cancellation: "bg-red-50 text-red-600",
  webpage: "bg-indigo-50 text-indigo-700",
  other: "bg-slate-100 text-slate-600",
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function sourceTypeLabel(value: string): string {
  return SOURCE_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value
}

export default function KbDocList({ initialDocs }: { initialDocs: KbDoc[] }) {
  const router = useRouter()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function handleDelete(id: string) {
    setDeletingId(id)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/knowledge-documents/${id}`, { method: "DELETE" })
      if (!res.ok) {
        setDeleteError("Failed to delete document. Please try again.")
        return
      }
      router.refresh()
    } finally {
      setDeletingId(null)
    }
  }

  if (initialDocs.length === 0) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400 shadow-sm">
        No knowledge documents yet. Import a URL or add a document manually.
      </p>
    )
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <ul className="divide-y divide-slate-100">
          {initialDocs.map((doc) => (
            <li key={doc.id} className="flex items-start justify-between gap-4 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900">{doc.title}</p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${SOURCE_TYPE_COLORS[doc.sourceType] ?? SOURCE_TYPE_COLORS.other}`}
                  >
                    {sourceTypeLabel(doc.sourceType)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{wordCount(doc.content)} words</p>
                {doc.sourceUrl && (
                  <p className="mt-0.5 truncate text-xs text-slate-400">{doc.sourceUrl}</p>
                )}
              </div>
              <button
                onClick={() => handleDelete(doc.id)}
                disabled={deletingId === doc.id}
                className="shrink-0 rounded px-2 py-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
              >
                {deletingId === doc.id ? "…" : "Delete"}
              </button>
            </li>
          ))}
        </ul>
      </div>
      {deleteError && (
        <p className="mt-2 text-xs text-red-600">{deleteError}</p>
      )}
    </>
  )
}
