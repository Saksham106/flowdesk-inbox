"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type DraftStatus = "none" | "proposed" | "approved" | "sent";

type DraftMetadata = {
  intent?: unknown;
  confidence?: unknown;
  riskLevel?: unknown;
  suggestedLabel?: unknown;
  escalationReason?: unknown;
  userInstruction?: unknown;
};

type DraftSnapshot = {
  id: string;
  text: string;
  status: DraftStatus | string;
  metadataJson?: DraftMetadata | null;
};

type DraftResponse = {
  draft?: DraftSnapshot | null;
  meta?: DraftMetadata | null;
};

type ActionState = "idle" | "suggesting" | "saving" | "sending" | "clearing";

function metadataText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

function getMetadata(response: DraftResponse): DraftMetadata | null {
  return response.draft?.metadataJson ?? response.meta ?? null;
}

export default function AIDraftPanel({
  conversationId,
  channelType,
  canSuggest,
  knowledgeDocumentCount,
  initialDraft,
  inline = false,
  isPersonal = false,
}: {
  conversationId: string;
  channelType: string;
  canSuggest: boolean;
  knowledgeDocumentCount: number;
  initialDraft: DraftSnapshot | null;
  inline?: boolean;
  isPersonal?: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftSnapshot | null>(initialDraft);
  const [text, setText] = useState(initialDraft?.text ?? "");
  const [metadata, setMetadata] = useState<DraftMetadata | null>(
    initialDraft?.metadataJson ?? null,
  );
  const [userInstruction, setUserInstruction] = useState("");
  const [action, setAction] = useState<ActionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isEmail = channelType === "email";
  const canRequestSuggestion = isEmail && canSuggest;
  const isBusy = action !== "idle";
  const trimmedText = text.trim();
  const hasDraftText = trimmedText.length > 0;
  const isDirty = text !== (draft?.text ?? "");

  const metadataRows = useMemo(
    () => [
      ["Intent", metadataText(metadata?.intent)],
      ["Confidence", metadataText(metadata?.confidence)],
      ["Risk", metadataText(metadata?.riskLevel)],
      ["Suggested label", metadataText(metadata?.suggestedLabel)],
      ["Escalation", metadataText(metadata?.escalationReason)],
      ["User instruction", metadataText(metadata?.userInstruction)],
    ],
    [metadata],
  );

  async function requestDraft(
    endpoint: string,
    options: RequestInit,
    fallbackMessage: string,
  ): Promise<DraftResponse> {
    const response = await fetch(endpoint, options);

    if (!response.ok) {
      throw new Error(fallbackMessage);
    }

    return response.json();
  }

  function applyDraftResponse(response: DraftResponse) {
    if (response.draft) {
      setDraft(response.draft);
      setText(response.draft.text);
    }

    setMetadata(getMetadata(response));
  }

  async function suggestReply() {
    if (!canRequestSuggestion || isBusy) {
      return;
    }

    setAction("suggesting");
    setError(null);
    setNotice(null);

    try {
      const response = await requestDraft(
        `/api/conversations/${conversationId}/draft/suggest`,
        buildSuggestRequest(userInstruction),
        "Failed to suggest a reply.",
      );
      applyDraftResponse(response);
      setNotice("Draft suggestion ready.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to suggest a reply.");
    } finally {
      setAction("idle");
    }
  }

  async function patchDraft(body: { text: string } | { status: DraftStatus }) {
    const response = await requestDraft(
      `/api/conversations/${conversationId}/draft`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      "Failed to update the draft.",
    );
    applyDraftResponse(response);
    return response;
  }

  async function saveEdits() {
    if (!hasDraftText || isBusy) {
      return;
    }

    setAction("saving");
    setError(null);
    setNotice(null);

    try {
      await patchDraft({ text: trimmedText });
      setNotice("Draft edits saved.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save edits.");
    } finally {
      setAction("idle");
    }
  }

  async function approveAndSend() {
    if (!hasDraftText || isBusy) {
      return;
    }

    setAction("sending");
    setError(null);
    setNotice(null);

    try {
      if (isDirty) {
        await patchDraft({ text: trimmedText });
      }

      await patchDraft({ status: "approved" });

      const response = await fetch(
        `/api/conversations/${conversationId}/draft/send-approved`,
        { method: "POST" },
      );

      if (!response.ok) {
        throw new Error("Failed to send approved draft.");
      }

      setDraft((current) =>
        current ? { ...current, status: "sent", text: trimmedText } : current,
      );
      setNotice("Approved draft sent.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send approved draft.");
    } finally {
      setAction("idle");
    }
  }

  async function clearDraft() {
    if (isBusy) {
      return;
    }

    setAction("clearing");
    setError(null);
    setNotice(null);

    try {
      await patchDraft({ status: "none" });
      setDraft(null);
      setText("");
      setMetadata(null);
      setNotice("Draft cleared.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear draft.");
    } finally {
      setAction("idle");
    }
  }

  const statusBadge =
    draft?.status && draft.status !== "none" ? (
      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium capitalize text-slate-600">
        {draft.status}
      </span>
    ) : null;

  const body = (
    <>
      {!inline && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-600">AI draft</h2>
            <p className="mt-1 text-xs text-slate-500">
              Review and approve before anything is sent.
            </p>
          </div>
          {statusBadge}
        </div>
      )}

      {inline && statusBadge && (
        <div className="mb-3 flex justify-end">{statusBadge}</div>
      )}

      {!isEmail ? (
        <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          AI suggestions are available for email conversations only.
        </p>
      ) : null}

      {isEmail && !canSuggest ? (
        <p className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {isPersonal
            ? "AI suggestions are temporarily unavailable."
            : "Add a business profile in Settings to enable suggestions."}
        </p>
      ) : null}

      {isEmail && !isPersonal && canSuggest && knowledgeDocumentCount === 0 ? (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No knowledge documents yet. Suggestions may be less specific.
        </p>
      ) : null}

      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Rough instruction
          </span>
          <textarea
            value={userInstruction}
            onChange={(event) => setUserInstruction(event.target.value)}
            rows={1}
            maxLength={500}
            placeholder="e.g. say yes, but only next week"
            className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none disabled:bg-slate-50"
            disabled={isBusy}
          />
        </label>

        <button
          type="button"
          onClick={suggestReply}
          disabled={!canRequestSuggestion || isBusy}
          className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {action === "suggesting" ? "Suggesting..." : "Suggest reply"}
        </button>

        {hasDraftText && (metadata?.riskLevel === "high" || metadata?.escalationReason) ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            Sensitive content detected. Review carefully before sending.
            {typeof metadata?.escalationReason === "string" && metadata.escalationReason
              ? ` ${metadata.escalationReason}`
              : null}
          </p>
        ) : null}

        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={hasDraftText ? 6 : 3}
          placeholder="AI draft will appear here"
          className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none disabled:bg-slate-50"
          disabled={isBusy}
        />

        {metadata ? (
          <dl className="grid grid-cols-1 gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs">
            {metadataRows.map(([label, value]) =>
              value ? (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="shrink-0 font-medium text-slate-500">{label}</dt>
                  <dd className="text-right text-slate-700">{value}</dd>
                </div>
              ) : null,
            )}
          </dl>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {notice ? <p className="text-sm text-green-700">{notice}</p> : null}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={saveEdits}
            disabled={!hasDraftText || isBusy}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {action === "saving" ? "Saving..." : "Save edits"}
          </button>
          <button
            type="button"
            onClick={clearDraft}
            disabled={isBusy || (!draft && !text)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {action === "clearing" ? "Clearing..." : "Clear"}
          </button>
        </div>

        <button
          type="button"
          onClick={approveAndSend}
          disabled={!hasDraftText || isBusy}
          className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {action === "sending" ? "Sending..." : "Approve & Send"}
        </button>
      </div>
    </>
  );

  if (inline) return <div>{body}</div>;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      {body}
    </div>
  );
}

function buildSuggestRequest(userInstruction: string): RequestInit {
  const trimmed = userInstruction.trim();
  if (!trimmed) {
    return { method: "POST" };
  }

  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userInstruction: trimmed }),
  };
}
