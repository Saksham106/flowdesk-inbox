"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
}: {
  conversationId: string;
  channelType: string;
  canSuggest: boolean;
  isPersonal?: boolean;
  initialDraft: DraftSnapshot | null;
  conciergeTemplates?: Array<{ id: string; title: string; content: string }>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftSnapshot | null>(initialDraft);
  const [text, setText] = useState(initialDraft?.text ?? "");
  const [instruction, setInstruction] = useState("");
  const [action, setAction] = useState<ActionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showInstruction, setShowInstruction] = useState(false)
  const [isFocused, setIsFocused] = useState(false);

  const isEmail = channelType === "email";
  const canAI = isEmail && canSuggest;
  const isBusy = action !== "idle";
  const trimmedText = text.trim();
  const hasDraftText = trimmedText.length > 0;

  const riskLevel = draft?.metadataJson?.riskLevel;
  const escalationReason = draft?.metadataJson?.escalationReason;
  const isRisky = hasDraftText && (riskLevel === "high" || Boolean(escalationReason));

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
        setNotice("Draft ready — review and edit before sending.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate draft.");
    } finally {
      setAction("idle");
    }
  }

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
        setDraft((d) => d ? { ...d, status: "sent", text: trimmedText } : d);
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
      setNotice("Sent.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send.");
    } finally {
      setAction("idle");
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

  return (
    <div className="space-y-3">
      {/* Draft status indicator */}
      {draftStatusLabel && (
        <div className="flex items-center justify-between">
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
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          Sensitive content detected — review carefully before sending.
          {typeof escalationReason === "string" && escalationReason ? ` ${escalationReason}` : ""}
        </p>
      )}

      {/* Main textarea */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => { if (!hasDraftText) setIsFocused(false) }}
        rows={isFocused || hasDraftText ? 5 : 2}
        placeholder={canAI ? "Type a reply, or add an instruction below and click Draft with AI…" : "Type your reply…"}
        className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm leading-relaxed text-slate-900 focus:border-slate-400 focus:outline-none disabled:bg-slate-50"
        disabled={isBusy}
      />

      {/* Template picker — shown when concierge templates are available */}
      {canAI && conciergeTemplates && conciergeTemplates.length > 0 && (
        <div>
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

      {/* Instruction row — collapsible hint for AI */}
      {canAI && (
        <div>
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
      {error && <p className="text-xs text-red-600">{error}</p>}
      {notice && <p className="text-xs text-emerald-700">{notice}</p>}

      {/* No business profile hint */}
      {isEmail && !isPersonal && !canSuggest && (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Add a business profile in Settings to enable AI suggestions.
        </p>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {canAI && (
          <button
            type="button"
            onClick={suggestReply}
            disabled={isBusy}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {action === "suggesting" ? "Drafting…" : "Draft with AI"}
          </button>
        )}
        <button
          type="button"
          onClick={send}
          disabled={!hasDraftText || isBusy}
          className="flex-1 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {action === "sending" ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
