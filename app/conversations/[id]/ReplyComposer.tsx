"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type DraftStatus = "none" | "proposed" | "approved" | "sent";

type DraftMetadata = {
  riskLevel?: unknown;
  escalationReason?: unknown;
  userInstruction?: unknown;
};

type DraftSnapshot = {
  id: string;
  text: string;
  status: DraftStatus | string;
  metadataJson?: DraftMetadata | null;
};

type ActionState = "idle" | "suggesting" | "sending" | "clearing";

export default function ReplyComposer({
  conversationId,
  channelType,
  canSuggest,
  isPersonal = false,
  initialDraft,
  conciergeTemplates,
  senderAddress,
  threadSubject,
}: {
  conversationId: string;
  channelType: string;
  canSuggest: boolean;
  isPersonal?: boolean;
  initialDraft: DraftSnapshot | null;
  conciergeTemplates?: Array<{ id: string; title: string; content: string }>;
  senderAddress?: string;
  threadSubject?: string;
}) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState<DraftSnapshot | null>(initialDraft);
  const [text, setText] = useState(initialDraft?.text ?? "");
  const [instruction, setInstruction] = useState("");
  const [action, setAction] = useState<ActionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showInstruction, setShowInstruction] = useState(false)
  const [isFocused, setIsFocused] = useState(false);
  const [isExpanded, setIsExpanded] = useState(initialDraft !== null)
  const [snippets, setSnippets] = useState<Array<{id:string;title:string;content:string}>>([])
  const [showSnippets, setShowSnippets] = useState(false)
  const [snippetsLoaded, setSnippetsLoaded] = useState(false)
  const [ccOpen, setCcOpen] = useState(false)
  const [bccOpen, setBccOpen] = useState(false)
  const [cc, setCc] = useState("")
  const [bcc, setBcc] = useState("")
  const [showNextStep, setShowNextStep] = useState(false)

  const isEmail = channelType === "email";
  const canAI = isEmail && canSuggest;
  const isBusy = action !== "idle";
  const trimmedText = text.trim();
  const hasDraftText = trimmedText.length > 0;

  const riskLevel = draft?.metadataJson?.riskLevel;
  const escalationReason = draft?.metadataJson?.escalationReason;
  const isRisky = hasDraftText && (riskLevel === "high" || Boolean(escalationReason));

  useEffect(() => {
    if (!initialDraft || initialDraft.status === "none" || initialDraft.status === "sent" || !initialDraft.text.trim()) {
      return
    }
    if (draft?.id === initialDraft.id && draft?.status === initialDraft.status && draft?.text === initialDraft.text) {
      return
    }
    setDraft(initialDraft)
    setText(initialDraft.text)
    setIsExpanded(true)
    setShowNextStep(false)
  }, [initialDraft, draft?.id, draft?.status, draft?.text])

  async function loadSnippets() {
    if (snippetsLoaded) return
    const res = await fetch("/api/snippets")
    const data = await res.json()
    setSnippets((data.snippets ?? []).filter((s: {status:string}) => s.status === "active"))
    setSnippetsLoaded(true)
  }

  function insertSnippet(content: string, id: string) {
    const ta = textareaRef.current
    if (!ta) {
      setText((prev) => prev + (prev ? "\n\n" : "") + content)
    } else {
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const before = text.slice(0, start)
      const after = text.slice(end)
      const newText = before + content + after
      setText(newText)
      // Restore cursor position after React re-render
      requestAnimationFrame(() => {
        ta.selectionStart = start + content.length
        ta.selectionEnd = start + content.length
        ta.focus()
      })
    }
    setShowSnippets(false)
    fetch(`/api/snippets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incrementUseCount: true }),
    }).catch(() => {})
  }

  async function assertOk(response: Response, fallback: string) {
    if (response.ok) return;
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.error === "string" ? body.error : fallback);
  }

  async function suggestReply() {
    if (!canAI || isBusy) return;
    setAction("suggesting");
    setError(null);
    setNotice(null);
    try {
      const init: RequestInit = instruction.trim()
        ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userInstruction: instruction.trim() }) }
        : { method: "POST" };
      const res = await fetch(`/api/conversations/${conversationId}/draft/suggest`, init);
      if (!res.ok) throw new Error("Failed to generate draft.");
      const data = await res.json();
      const newDraft: DraftSnapshot | null = data.draft ?? null;
      if (newDraft) {
        setDraft(newDraft);
        setText(newDraft.text);
        setShowNextStep(false);
        setNotice("Draft ready — review and edit before sending.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate draft.");
    } finally {
      setAction("idle");
    }
  }

  // TODO: wire cc/bcc into send API when backend supports it
  async function send() {
    if (!hasDraftText || isBusy) return;
    setAction("sending");
    setError(null);
    setNotice(null);
    try {
      if (draft && draft.status !== "none") {
        // AI draft path: update text if edited, approve, then send
        const isDirty = trimmedText !== draft.text;
        if (isDirty) {
          const updateRes = await fetch(`/api/conversations/${conversationId}/draft`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: trimmedText }),
          });
          await assertOk(updateRes, "Failed to update draft.");
        }
        const approveRes = await fetch(`/api/conversations/${conversationId}/draft`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "approved" }),
        });
        await assertOk(approveRes, "Failed to approve draft.");
        const sendRes = await fetch(`/api/conversations/${conversationId}/draft/send-approved`, { method: "POST" });
        await assertOk(sendRes, "Failed to send.");
        setDraft(null);
        setText("");
      } else {
        // Manual path: send directly
        const sendRes = await fetch(`/api/conversations/${conversationId}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: trimmedText }),
        });
        await assertOk(sendRes, "Failed to send.");
        setDraft(null);
        setText("");
      }
      setInstruction("");
      setShowNextStep(true);
      setNotice("Sent. What should happen next?");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send.");
    } finally {
      setAction("idle");
    }
  }

  async function setWorkflowStatus(workflowStatus: "done" | "waiting_on") {
    if (isBusy) return
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/conversations/${conversationId}/workflow-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowStatus }),
      })
      await assertOk(response, "Failed to update status.")
      setShowNextStep(false)
      setNotice(workflowStatus === "done" ? "Marked done." : "Marked waiting on them.")
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status.")
    }
  }

  async function clearDraft() {
    if (isBusy) return;
    if (draft && draft.status !== "none") {
      setAction("clearing");
      try {
        await fetch(`/api/conversations/${conversationId}/draft`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "none" }),
        });
      } catch { /* ignore */ } finally {
        setAction("idle");
      }
    }
    setDraft(null);
    setText("");
    setInstruction("");
    setError(null);
    setNotice(null);
    router.refresh();
  }

  if (!isEmail) {
    return (
      <p className="px-3 py-2 text-xs text-slate-500 rounded-lg border border-slate-200 bg-slate-50">
        AI suggestions are available for email conversations only.
      </p>
    );
  }

  const draftStatusLabel = draft?.status && draft.status !== "none" && draft.status !== "sent"
    ? "AI draft"
    : draft?.status === "sent"
      ? "Sent"
      : null;

  if (!isExpanded) {
    return (
      <button
        type="button"
        onClick={() => setIsExpanded(true)}
        className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left hover:bg-slate-100 transition"
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-600">
          Me
        </div>
        <span className="flex-1 text-sm text-slate-400">
          {senderAddress ? `Reply to ${senderAddress}…` : "Write a reply…"}
        </span>
        <span className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
          Reply
        </span>
      </button>
    )
  }

  return (
    <div className="space-y-0 rounded-xl border border-slate-300 overflow-hidden bg-white shadow-sm">
      {/* Email header fields */}
      <div className="border-b border-slate-100">
        {/* To field */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
          <span className="text-[11px] font-semibold text-slate-400 w-6 shrink-0">To</span>
          <span className="flex-1 text-sm text-slate-700 truncate">
            {senderAddress ?? "—"}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {!ccOpen && (
              <button
                type="button"
                onClick={() => setCcOpen(true)}
                className="text-[11px] text-slate-400 hover:text-slate-600"
              >
                CC
              </button>
            )}
            {!bccOpen && (
              <button
                type="button"
                onClick={() => setBccOpen(true)}
                className="text-[11px] text-slate-400 hover:text-slate-600"
              >
                BCC
              </button>
            )}
          </div>
        </div>

        {/* CC field */}
        {ccOpen && (
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
            <span className="text-[11px] font-semibold text-slate-400 w-6 shrink-0">CC</span>
            <input
              type="text"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="cc@example.com"
              className="flex-1 text-sm text-slate-700 outline-none bg-transparent"
              disabled={isBusy}
            />
            <button
              type="button"
              onClick={() => { setCcOpen(false); setCc("") }}
              className="text-[11px] text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
          </div>
        )}

        {/* BCC field */}
        {bccOpen && (
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
            <span className="text-[11px] font-semibold text-slate-400 w-6 shrink-0">BCC</span>
            <input
              type="text"
              value={bcc}
              onChange={(e) => setBcc(e.target.value)}
              placeholder="bcc@example.com"
              className="flex-1 text-sm text-slate-700 outline-none bg-transparent"
              disabled={isBusy}
            />
            <button
              type="button"
              onClick={() => { setBccOpen(false); setBcc("") }}
              className="text-[11px] text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
          </div>
        )}

        {/* Subject (read-only) */}
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="text-[11px] font-semibold text-slate-400 w-6 shrink-0">Subj</span>
          <span className="flex-1 text-[12px] text-slate-400 truncate">{threadSubject ?? "(no subject)"}</span>
        </div>
      </div>

      {/* Draft status indicator */}
      {draftStatusLabel && (
        <div className="flex items-center justify-between px-3 pt-2">
          <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-[10px] font-bold text-blue-700">
            {draftStatusLabel}
          </span>
          <button
            type="button"
            onClick={clearDraft}
            disabled={isBusy}
            className="text-[11px] text-slate-400 hover:text-slate-600 disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      )}

      {/* Risk warning */}
      {isRisky && (
        <p className="mx-3 mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          Sensitive content detected — review carefully before sending.
          {typeof escalationReason === "string" && escalationReason ? ` ${escalationReason}` : ""}
        </p>
      )}

      {/* Main textarea */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => { if (!hasDraftText) setIsFocused(false) }}
        rows={isFocused || hasDraftText ? 5 : 3}
        placeholder={canAI ? "Type a reply, or use Draft with AI below…" : "Type your reply…"}
        className="w-full resize-none px-3 py-2.5 text-sm leading-relaxed text-slate-900 focus:outline-none disabled:bg-slate-50"
        disabled={isBusy}
        autoFocus
      />

      {/* Template picker */}
      {canAI && conciergeTemplates && conciergeTemplates.length > 0 && (
        <div className="px-3 pb-2">
          <label className="text-xs text-slate-500">Start from template</label>
          <select
            className="mt-0.5 block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900"
            defaultValue=""
            onChange={(e) => {
              const tpl = conciergeTemplates.find((t) => t.id === e.target.value)
              if (tpl) {
                setInstruction(`Use this template as a starting point:\n${tpl.content}`)
                setShowInstruction(true)
              }
            }}
          >
            <option value="">— pick a template —</option>
            {conciergeTemplates.map((t) => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </select>
        </div>
      )}

      {/* AI instruction row */}
      {canAI && (
        <div className="px-3 pb-2">
          {!showInstruction ? (
            <button
              type="button"
              onClick={() => setShowInstruction(true)}
              className="text-[11px] text-slate-400 hover:text-slate-600"
            >
              + Add instruction for AI
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="e.g. say yes, but only next week"
                maxLength={300}
                className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs focus:border-slate-400 focus:outline-none disabled:bg-slate-50"
                disabled={isBusy}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); suggestReply(); } }}
              />
              <button
                type="button"
                onClick={() => { setShowInstruction(false); setInstruction(""); }}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      )}

      {/* Error / notice */}
      {error && <p className="px-3 pb-1 text-xs text-red-600">{error}</p>}
      {notice && <p className="px-3 pb-1 text-xs text-emerald-700">{notice}</p>}
      {showNextStep && (
        <div className="mx-3 mb-2 flex flex-wrap gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2">
          <button
            type="button"
            onClick={() => setWorkflowStatus("done")}
            disabled={isBusy}
            className="rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            Done
          </button>
          <button
            type="button"
            onClick={() => setWorkflowStatus("waiting_on")}
            disabled={isBusy}
            className="rounded-md border border-emerald-200 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
          >
            Waiting On
          </button>
        </div>
      )}

      {/* No business profile hint */}
      {isEmail && !isPersonal && !canSuggest && (
        <p className="mx-3 mb-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Add a business profile in Settings to enable AI suggestions.
        </p>
      )}

      {/* Bottom toolbar */}
      <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-2">
        {canAI && (
          <button
            type="button"
            onClick={suggestReply}
            disabled={isBusy}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {action === "suggesting" ? "Drafting…" : "Draft with AI"}
          </button>
        )}
        {/* Snippet picker */}
        <div className="relative">
          <button
            type="button"
            onClick={() => { loadSnippets(); setShowSnippets((v) => !v) }}
            className="text-xs text-slate-400 hover:text-slate-700 px-2 py-1 rounded border border-transparent hover:border-slate-200"
          >
            Snippets
          </button>
          {showSnippets && snippets.length > 0 && (
            <div className="absolute bottom-8 left-0 z-10 w-64 rounded-lg border border-slate-200 bg-white shadow-lg max-h-48 overflow-y-auto">
              {snippets.map((s) => (
                <button
                  key={s.id}
                  onClick={() => insertSnippet(s.content, s.id)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 border-b border-slate-100 last:border-0"
                >
                  <span className="font-medium text-slate-700">{s.title}</span>
                  <span className="block text-slate-400 truncate">{s.content}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="flex-1" />
        <button
          type="button"
          onClick={async () => {
            if (hasDraftText && !draft) {
              if (!window.confirm("Discard your reply?")) return
            }
            await clearDraft()
            setIsExpanded(false)
          }}
          disabled={isBusy}
          className="text-xs text-slate-400 hover:text-slate-600 disabled:opacity-50"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={send}
          disabled={!hasDraftText || isBusy}
          className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {action === "sending" ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
