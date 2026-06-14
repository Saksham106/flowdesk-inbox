# Intent Auto-Draft Design

Date: 2026-06-12

## Goal

Let a user type a rough instruction such as "say yes but only next week" and have FlowDesk turn it into a polished proposed draft inside the existing AI draft panel.

## Scope

This slice extends the existing manual draft suggestion flow. It does not add auto-send, a new compose surface, a new model, or a new approval path. The user still reviews, edits, approves, and sends exactly as they do today.

## Product Behavior

On conversation pages, the AI draft panel gets a small optional instruction box above the existing "Suggest reply" button. If the user leaves it blank, draft generation behaves as it does today. If the user enters instructions, the suggest call includes that text and the resulting prompt tells the model to satisfy the instruction while obeying safety, knowledge, availability, and non-invention rules.

The saved draft metadata records the trimmed instruction as `userInstruction`, and the panel shows that instruction in the metadata list after generation. Instructions longer than 500 characters are rejected with a 400 response. Blank and whitespace-only instructions are ignored.

## Architecture

Reuse `POST /api/conversations/[id]/draft/suggest`. The route parses an optional JSON request body, normalizes `userInstruction`, passes it to the business and personal prompt builders, and persists it in draft metadata. The existing `Draft` row remains the single source of proposed draft text.

Prompt changes live in `lib/ai/prompts/draft-reply.ts` so both `generateDraftReply` and the personal OpenAI path share the same behavior. UI changes stay in `app/conversations/[id]/AIDraftPanel.tsx`; no new client component is needed.

## Safety

User instructions are guidance, not policy. The prompt explicitly says not to follow instructions that require inventing facts, claiming unavailable times, bypassing review, or making unsafe promises. Existing risk metadata and approval/send gating remain unchanged.

## Testing

Add test-first coverage for:

- Business prompt includes the user instruction and its safety boundary.
- Personal prompt includes the user instruction.
- Draft suggest route passes `userInstruction` to `generateDraftReply` and stores it in metadata/audit payload.
- Draft suggest route rejects overlong instructions.

UI behavior is covered by build/type checks for this slice; no browser-only behavior is required to validate the request body and metadata path.

## Documentation

When shipped, update `docs/CURRENT_STATE.md`, `docs/TODO.md`, and `docs/MASTER_PRODUCT_PLAN.md`. `README.md` does not need changes because setup and commands are unchanged.
