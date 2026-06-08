"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { KnowledgeDocument } from "@prisma/client";
import KnowledgeDocumentForm from "./KnowledgeDocumentForm";
import { SOURCE_TYPE_OPTIONS } from "@/lib/knowledge-document-types";

const SOURCE_TYPE_COLORS: Record<string, string> = {
  faq: "bg-blue-50 text-blue-700",
  service: "bg-purple-50 text-purple-700",
  policy: "bg-amber-50 text-amber-700",
  pricing: "bg-green-50 text-green-700",
  prep_instructions: "bg-teal-50 text-teal-700",
  cancellation: "bg-red-50 text-red-700",
  other: "bg-slate-100 text-slate-600",
};

interface Props {
  initialDocuments: KnowledgeDocument[];
}

interface EditState {
  title: string;
  sourceType: string;
  content: string;
  loading: boolean;
  error: string | null;
}

export default function KnowledgeDocumentList({ initialDocuments }: Props) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({
    title: "",
    sourceType: "faq",
    content: "",
    loading: false,
    error: null,
  });

  function startEdit(doc: KnowledgeDocument) {
    setEditingId(doc.id);
    setEditState({
      title: doc.title,
      sourceType: doc.sourceType,
      content: doc.content,
      loading: false,
      error: null,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditState({ title: "", sourceType: "faq", content: "", loading: false, error: null });
  }

  async function handleSave(id: string) {
    // Capture current values immediately — avoids stale closure if React batches state updates
    const { title, sourceType, content } = editState;
    setEditState((s) => ({ ...s, loading: true, error: null }));

    const res = await fetch(`/api/knowledge-documents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, sourceType, content }),
    });

    const data = await res.json();

    if (!res.ok) {
      setEditState((s) => ({ ...s, loading: false, error: data.error ?? "Failed to update" }));
      return;
    }

    setEditingId(null);
    router.refresh();
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this document?")) return;

    const res = await fetch(`/api/knowledge-documents/${id}`, { method: "DELETE" });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "Failed to delete document");
      return;
    }

    router.refresh();
  }

  return (
    <div className="space-y-3">
      {initialDocuments.length === 0 && !showForm && (
        <p className="text-sm text-slate-500">No documents yet. Add your first document below.</p>
      )}

      {initialDocuments.map((doc) =>
        editingId === doc.id ? (
          <div key={doc.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Title</label>
                <input
                  type="text"
                  value={editState.title}
                  onChange={(e) => setEditState((s) => ({ ...s, title: e.target.value }))}
                  required
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Type</label>
                <select
                  value={editState.sourceType}
                  onChange={(e) => setEditState((s) => ({ ...s, sourceType: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                >
                  {SOURCE_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Content</label>
              <textarea
                value={editState.content}
                onChange={(e) => setEditState((s) => ({ ...s, content: e.target.value }))}
                rows={6}
                className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              />
            </div>
            {editState.error && <p className="text-sm text-red-600">{editState.error}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => handleSave(doc.id)}
                disabled={editState.loading}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {editState.loading ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div
            key={doc.id}
            className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium">{doc.title}</p>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${SOURCE_TYPE_COLORS[doc.sourceType] ?? "bg-slate-100 text-slate-600"}`}
                >
                  {SOURCE_TYPE_OPTIONS.find((o) => o.value === doc.sourceType)?.label ?? doc.sourceType}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-slate-500">{doc.content}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => startEdit(doc)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                Edit
              </button>
              <button
                onClick={() => handleDelete(doc.id)}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          </div>
        )
      )}

      {showForm ? (
        <KnowledgeDocumentForm
          onSuccess={() => {
            setShowForm(false);
            router.refresh();
          }}
        />
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          + Add Document
        </button>
      )}
    </div>
  );
}
