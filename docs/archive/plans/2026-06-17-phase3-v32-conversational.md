# Phase 3 v3.2 — Conversational Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship natural-language search (PostgreSQL tsvector) and Ask My Inbox chat (stateless RAG), giving users a search bar in the inbox and a chat page that answers questions about their email history.

**Architecture:** A `searchVector tsvector` column with GIN index on `Message` powers keyword search. `lib/agent/search.ts` converts natural-language queries to tsquery. `lib/agent/inbox-chat.ts` builds a RAG pipeline over search results, PersonMemory facts, and attachment data, then streams an LLM answer. Chat is stateless — no history persisted. Both features add one new page each (`/search`, `/chat`).

**Tech Stack:** TypeScript, Prisma (PostgreSQL tsvector + GIN index), Next.js App Router (streaming via ReadableStream), Vitest

**Spec:** `docs/archive/specs/2026-06-17-phase3-design.md` (v3.2 section)

**Prerequisite:** v3.1 Intelligence Layer plan must be complete (second-brain retrieval and attachment data are RAG sources for chat).

---

## File Structure

**New files:**
- `prisma/migrations/20260617004000_add_message_search_vector/migration.sql`
- `lib/agent/search.ts` — query-to-tsquery conversion + search execution
- `lib/agent/inbox-chat.ts` — RAG pipeline: search + facts + attachments → LLM stream
- `tests/search.test.ts`
- `app/api/search/route.ts` — GET `?q=...`
- `app/api/chat/route.ts` — POST streaming
- `app/search/page.tsx` — search results page
- `app/chat/page.tsx` — chat interface page
- `app/chat/ChatInterface.tsx` — client-side chat UI with streaming

**Modified files:**
- `prisma/schema.prisma` — add `searchVector` to Message (Unsupported("tsvector"))
- `app/inbox/page.tsx` — wire existing `<SearchInput>` to `/search` instead of inline filter
- `app/components/AppRail.tsx` — add chat icon to sidebar navigation

---

## Task 1: Message Search Vector Migration

**Files:**
- Create: `prisma/migrations/20260617004000_add_message_search_vector/migration.sql`
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Create migration SQL**

```sql
-- prisma/migrations/20260617004000_add_message_search_vector/migration.sql

-- Add search vector column
ALTER TABLE "Message" ADD COLUMN "searchVector" tsvector;

-- Create update function
CREATE OR REPLACE FUNCTION message_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" := to_tsvector('english',
    COALESCE(NEW.subject, '') || ' ' ||
    COALESCE(NEW.body, '') || ' ' ||
    COALESCE(NEW."fromE164", '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for new and updated messages
CREATE TRIGGER message_search_vector_trigger
  BEFORE INSERT OR UPDATE ON "Message"
  FOR EACH ROW EXECUTE FUNCTION message_search_vector_update();

-- Backfill existing messages (may take a moment on large tables)
UPDATE "Message" SET "searchVector" = to_tsvector('english',
  COALESCE(subject, '') || ' ' ||
  COALESCE(body, '') || ' ' ||
  COALESCE("fromE164", '')
);

-- GIN index for fast full-text search
CREATE INDEX "Message_searchVector_idx" ON "Message" USING GIN ("searchVector");
```

- [ ] **Step 2: Apply migration**

```bash
npx prisma db execute --file prisma/migrations/20260617004000_add_message_search_vector/migration.sql
npx prisma migrate resolve --applied 20260617004000_add_message_search_vector
npx prisma generate
```

Expected output includes: "Migration 20260617004000_add_message_search_vector marked as applied."

- [ ] **Step 3: Update schema.prisma**

In the `Message` model in `prisma/schema.prisma`, add:

```prisma
searchVector Unsupported("tsvector")?
```

This lets Prisma know the column exists without trying to manage it.

- [ ] **Step 4: Commit**

```bash
git add prisma/migrations/20260617004000_add_message_search_vector/ prisma/schema.prisma
git commit -m "feat: add tsvector full-text search column + GIN index on Message"
```

---

## Task 2: Search Library + Tests

**Files:**
- Create: `lib/agent/search.ts`
- Create: `tests/search.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/search.test.ts
import { describe, it, expect } from "vitest"
import { buildTsQuery } from "@/lib/agent/search"

describe("buildTsQuery", () => {
  it("converts single word to tsquery", () => {
    expect(buildTsQuery("invoice")).toBe("invoice")
  })

  it("joins multiple words with AND", () => {
    expect(buildTsQuery("invoice paypal")).toBe("invoice & paypal")
  })

  it("handles quoted phrase as single token", () => {
    expect(buildTsQuery('"Johnson contract"')).toBe("Johnson <-> contract")
  })

  it("strips common stop words", () => {
    // "the" and "is" are stop words, should be removed
    const result = buildTsQuery("the invoice is due")
    expect(result).toContain("invoice")
    expect(result).toContain("due")
    expect(result).not.toContain("the")
    expect(result).not.toContain("is")
  })

  it("returns empty string for all-stop-word query", () => {
    expect(buildTsQuery("the a is")).toBe("")
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- --reporter=verbose tests/search.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement `lib/agent/search.ts`**

```typescript
import { prisma } from "@/lib/prisma"

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "to", "of", "in", "on", "at", "by", "for", "with", "from", "into",
  "about", "as", "and", "or", "but", "not", "if", "then", "i", "me",
  "my", "you", "your", "it", "its", "we", "our", "they", "their",
])

export function buildTsQuery(query: string): string {
  // Handle quoted phrases — convert "foo bar" to foo <-> bar (phrase search)
  const phraseMatches: string[] = []
  const queryWithoutPhrases = query.replace(/"([^"]+)"/g, (_, phrase) => {
    const words = phrase.trim().split(/\s+/)
    phraseMatches.push(words.join(" <-> "))
    return ""
  })

  const words = queryWithoutPhrases
    .trim()
    .split(/\s+/)
    .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w))

  const allTokens = [...words, ...phraseMatches].filter(Boolean)
  return allTokens.join(" & ")
}

export type SearchResult = {
  conversationId: string
  subject: string | null
  participants: string
  matchSnippet: string
  matchedAt: Date
}

export async function searchMessages(
  tenantId: string,
  query: string,
  limit = 20,
  offset = 0
): Promise<{ results: SearchResult[]; total: number }> {
  const tsquery = buildTsQuery(query)
  if (!tsquery) return { results: [], total: 0 }

  // Use raw SQL for tsvector queries (Prisma does not support tsvector natively)
  const rows = await prisma.$queryRaw<
    Array<{
      conversationId: string
      subject: string | null
      fromE164: string | null
      body: string
      createdAt: Date
    }>
  >`
    SELECT DISTINCT ON (m."conversationId")
      m."conversationId",
      m.subject,
      m."fromE164",
      m.body,
      m."createdAt"
    FROM "Message" m
    INNER JOIN "Conversation" c ON c.id = m."conversationId"
    WHERE c."tenantId" = ${tenantId}
      AND m."searchVector" @@ to_tsquery('english', ${tsquery})
    ORDER BY m."conversationId", m."createdAt" DESC
    LIMIT ${limit + offset}
  `

  const paginated = rows.slice(offset, offset + limit)

  const results: SearchResult[] = paginated.map((row) => {
    // Build a short snippet around the matching text
    const bodyLower = row.body.toLowerCase()
    const queryWords = tsquery.split(/\s*[&|<>]\s*/).filter((w) => /^[a-z]/.test(w))
    let snippetStart = 0
    for (const word of queryWords) {
      const idx = bodyLower.indexOf(word)
      if (idx >= 0) { snippetStart = Math.max(0, idx - 60); break }
    }
    const snippet = row.body.slice(snippetStart, snippetStart + 200).replace(/\s+/g, " ").trim()

    return {
      conversationId: row.conversationId,
      subject: row.subject,
      participants: row.fromE164 ?? "",
      matchSnippet: snippet,
      matchedAt: row.createdAt,
    }
  })

  return { results, total: rows.length }
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npm test -- --reporter=verbose tests/search.test.ts
```
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/agent/search.ts tests/search.test.ts
git commit -m "feat: add natural-language search library with tsvector query builder"
```

---

## Task 3: Search API Route + Search Page

**Files:**
- Create: `app/api/search/route.ts`
- Create: `app/search/page.tsx`

- [ ] **Step 1: Create search API route**

```typescript
// app/api/search/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { searchMessages } from "@/lib/agent/search"

export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const q = searchParams.get("q")?.trim() ?? ""
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10), 50)
  const offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10), 0)

  if (!q) return NextResponse.json({ results: [], total: 0 })

  const { results, total } = await searchMessages(session.user.tenantId, q, limit, offset)
  return NextResponse.json({ results, total, query: q })
}
```

- [ ] **Step 2: Create `/search` page**

```typescript
// app/search/page.tsx
import Link from "next/link"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { searchMessages } from "@/lib/agent/search"
import AppRail from "@/app/components/AppRail"

export const dynamic = "force-dynamic"

interface Props {
  searchParams: { q?: string }
}

export default async function SearchPage({ searchParams }: Props) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")

  const q = searchParams.q?.trim() ?? ""
  const { results, total } = q
    ? await searchMessages(session.user.tenantId, q, 20, 0)
    : { results: [], total: 0 }

  return (
    <div className="flex h-screen">
      <AppRail activeItem="search" />
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-2xl">
          <form method="GET" action="/search" className="mb-6">
            <div className="flex gap-2">
              <input
                name="q"
                defaultValue={q}
                placeholder="Search your inbox…"
                className="flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                autoFocus
              />
              <button
                type="submit"
                className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white"
              >
                Search
              </button>
            </div>
          </form>

          {q && (
            <p className="mb-4 text-xs text-slate-400">
              {total} result{total !== 1 ? "s" : ""} for &ldquo;{q}&rdquo;
            </p>
          )}

          <ul className="space-y-3">
            {results.map((r) => (
              <li key={r.conversationId}>
                <Link
                  href={`/conversations/${r.conversationId}`}
                  className="block rounded-xl border border-slate-100 bg-white px-5 py-4 shadow-sm transition hover:border-slate-200 hover:shadow"
                >
                  <p className="text-sm font-medium text-slate-900">
                    {r.subject ?? "(no subject)"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{r.participants}</p>
                  {r.matchSnippet && (
                    <p className="mt-1.5 text-xs text-slate-600 line-clamp-2">
                      …{r.matchSnippet}…
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>

          {q && results.length === 0 && (
            <p className="mt-8 text-center text-sm text-slate-400">
              No messages found for &ldquo;{q}&rdquo;
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Wire search bar in inbox to `/search` page**

In `app/inbox/SearchInput.tsx` (or wherever the search input is rendered), change form action from inline filtering to `action="/search"` with `method="GET"`. This replaces the existing `?q=` param behavior with navigation to the dedicated search page.

Find the `<SearchInput>` component. Check if it uses Next.js router push or a form. Update it to navigate to `/search?q=...`:

If it currently sets `?q=` in the inbox URL, update the submit handler:

```tsx
// In SearchInput.tsx, change the submit behavior:
function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
  e.preventDefault()
  const q = inputRef.current?.value?.trim()
  if (q) router.push(`/search?q=${encodeURIComponent(q)}`)
}
```

- [ ] **Step 4: Commit**

```bash
git add app/api/search/ app/search/ app/inbox/SearchInput.tsx
git commit -m "feat: natural-language search API route and /search results page"
```

---

## Task 4: Ask My Inbox Chat — RAG Pipeline

**Files:**
- Create: `lib/agent/inbox-chat.ts`

- [ ] **Step 1: Implement `lib/agent/inbox-chat.ts`**

```typescript
import { searchMessages } from "@/lib/agent/search"
import { searchFacts } from "@/lib/agent/second-brain"
import { prisma } from "@/lib/prisma"

export type ChatSource = {
  conversationId: string
  subject: string | null
  snippet: string
}

export type ChatResponse = {
  answer: string
  sources: ChatSource[]
}

const SYSTEM_PROMPT = `You are FlowDesk's inbox assistant. You help users understand their email inbox by answering questions based on email content provided to you. Be concise and direct. Cite specific emails when relevant. You only have access to the email content shown — never make up information not present in the context. If you can't find the answer, say so.`

export async function* streamChatAnswer(
  tenantId: string,
  userMessage: string
): AsyncGenerator<string> {
  // 1. Search messages
  const { results: searchResults } = await searchMessages(tenantId, userMessage, 5, 0)

  // 2. Search PersonMemory facts
  const factResults = await searchFacts(tenantId, userMessage)

  // 3. Search attachment data
  const attachmentContext = await searchAttachments(tenantId, userMessage)

  // 4. Build context
  const contextParts: string[] = []

  if (searchResults.length > 0) {
    contextParts.push(
      "Relevant emails:\n" +
        searchResults
          .map(
            (r, i) =>
              `[${i + 1}] Subject: ${r.subject ?? "(no subject)"}\nFrom: ${r.participants}\nExcerpt: ${r.matchSnippet}`
          )
          .join("\n\n")
    )
  }

  if (factResults.length > 0) {
    contextParts.push(
      "Known facts about contacts:\n" +
        factResults.slice(0, 5).map((r) => `- ${r.fact.fact}`).join("\n")
    )
  }

  if (attachmentContext.length > 0) {
    contextParts.push(
      "Relevant attachments:\n" +
        attachmentContext
          .map((a) => `- ${a.filename}: ${a.summary}`)
          .join("\n")
    )
  }

  if (contextParts.length === 0) {
    yield "I couldn't find any relevant emails or information to answer that question."
    return
  }

  const context = contextParts.join("\n\n---\n\n")
  const userPrompt = `Context from inbox:\n${context}\n\nQuestion: ${userMessage}`

  const OpenAI = (await import("openai")).default
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const stream = openai.chat.completions.stream({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 600,
    temperature: 0.3,
  })

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content
    if (delta) yield delta
  }

  // Append source references
  if (searchResults.length > 0) {
    yield "\n\n**Sources:**\n" +
      searchResults
        .map((r, i) => `[${i + 1}] [${r.subject ?? "Email"}](/conversations/${r.conversationId})`)
        .join("\n")
  }
}

async function searchAttachments(
  tenantId: string,
  query: string
): Promise<Array<{ filename: string; summary: string }>> {
  const queryLower = query.toLowerCase()
  const attachments = await prisma.emailAttachment.findMany({
    where: { tenantId, processedAt: { not: null } },
    select: { filename: true, extractedDataJson: true },
    take: 50,
  })

  return attachments
    .filter((a) => {
      const d = a.extractedDataJson as Record<string, unknown> | null
      if (!d) return false
      const summary = typeof d.summary === "string" ? d.summary : ""
      return (
        a.filename.toLowerCase().includes(queryLower) ||
        summary.toLowerCase().includes(queryLower) ||
        (Array.isArray(d.parties) && d.parties.some((p: unknown) => String(p).toLowerCase().includes(queryLower)))
      )
    })
    .slice(0, 3)
    .map((a) => {
      const d = a.extractedDataJson as Record<string, unknown> | null
      return {
        filename: a.filename,
        summary: typeof d?.summary === "string" ? d.summary : a.filename,
      }
    })
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/agent/inbox-chat.ts
git commit -m "feat: Ask My Inbox RAG pipeline with search + facts + attachment context"
```

---

## Task 5: Chat API Route (Streaming)

**Files:**
- Create: `app/api/chat/route.ts`

- [ ] **Step 1: Create streaming chat route**

```typescript
// app/api/chat/route.ts
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { streamChatAnswer } from "@/lib/agent/inbox-chat"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
  }

  const body = await request.json()
  const message = typeof body?.message === "string" ? body.message.trim() : ""
  if (!message) {
    return new Response(JSON.stringify({ error: "message required" }), { status: 400 })
  }

  const tenantId = session.user.tenantId

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamChatAnswer(tenantId, message)) {
          controller.enqueue(encoder.encode(chunk))
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Chat error"
        controller.enqueue(encoder.encode(`\n\nError: ${msg}`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    },
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/chat/
git commit -m "feat: streaming /api/chat route for Ask My Inbox"
```

---

## Task 6: Chat UI — ChatInterface + /chat Page

**Files:**
- Create: `app/chat/ChatInterface.tsx`
- Create: `app/chat/page.tsx`
- Modify: `app/components/AppRail.tsx`

- [ ] **Step 1: Create ChatInterface.tsx**

```tsx
// app/chat/ChatInterface.tsx
"use client"

import { useState, useRef, useEffect } from "react"
import ReactMarkdown from "react-markdown"

type Message = {
  role: "user" | "assistant"
  content: string
}

const SUGGESTED_QUESTIONS = [
  "Who owes me money?",
  "Did anyone email about a contract?",
  "What's the status of my latest invoice?",
  "Show me all medical appointment reminders",
  "What did my most important clients say recently?",
]

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  async function send(text: string) {
    if (!text.trim() || streaming) return
    setInput("")
    setMessages((prev) => [...prev, { role: "user", content: text }])
    setStreaming(true)

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    })

    if (!res.ok || !res.body) {
      setMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong. Please try again." }])
      setStreaming(false)
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let assistantContent = ""

    setMessages((prev) => [...prev, { role: "assistant", content: "" }])

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      assistantContent += decoder.decode(value, { stream: true })
      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: "assistant", content: assistantContent }
        return updated
      })
    }

    setStreaming(false)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className="text-center">
              <p className="text-lg font-semibold text-slate-800">Ask My Inbox</p>
              <p className="mt-1 text-sm text-slate-400">Ask anything about your email history.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs text-slate-600 shadow-sm hover:border-slate-300 hover:bg-slate-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mx-auto max-w-2xl space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                  msg.role === "user"
                    ? "bg-slate-900 text-white"
                    : "border border-slate-100 bg-white text-slate-800 shadow-sm"
                }`}
              >
                {msg.role === "assistant" ? (
                  <ReactMarkdown
                    components={{
                      a: ({ href, children }) => (
                        <a href={href} className="underline hover:text-slate-600">
                          {children}
                        </a>
                      ),
                    }}
                  >
                    {msg.content || (streaming ? "▌" : "")}
                  </ReactMarkdown>
                ) : (
                  msg.content
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-slate-100 px-4 py-4">
        <form
          onSubmit={(e) => { e.preventDefault(); send(input) }}
          className="mx-auto flex max-w-2xl gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your inbox…"
            disabled={streaming}
            className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:bg-slate-50"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {streaming ? "…" : "Ask"}
          </button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Check if react-markdown is installed**

```bash
grep "react-markdown" package.json
```

If not present:

```bash
npm install react-markdown
```

- [ ] **Step 3: Create `/chat` page**

```typescript
// app/chat/page.tsx
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import AppRail from "@/app/components/AppRail"
import ChatInterface from "@/app/chat/ChatInterface"

export const dynamic = "force-dynamic"

export default async function ChatPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")

  return (
    <div className="flex h-screen">
      <AppRail activeItem="chat" />
      <main className="flex flex-1 flex-col overflow-hidden">
        <ChatInterface />
      </main>
    </div>
  )
}
```

- [ ] **Step 4: Add chat icon to AppRail**

In `app/components/AppRail.tsx`, find where nav items are defined. Add a chat entry:

```tsx
{ href: "/chat", label: "Ask Inbox", icon: "💬", key: "chat" },
```

Also add search:

```tsx
{ href: "/search", label: "Search", icon: "🔍", key: "search" },
```

Pass `activeItem` prop through from the page if not already wired.

- [ ] **Step 5: Commit**

```bash
git add app/chat/ app/components/AppRail.tsx package.json package-lock.json
git commit -m "feat: Ask My Inbox chat UI with streaming responses and suggested questions"
```

---

## Task 7: Integration Verification

- [ ] **Step 1: Run full test suite**

```bash
npm test
```
Expected: all tests PASS (build-time errors would show here)

- [ ] **Step 2: Build check**

```bash
npm run build
```
Expected: build succeeds with no type errors

- [ ] **Step 3: Start dev server and verify search**

```bash
npm run dev
```

Navigate to `/inbox` — confirm search bar navigates to `/search?q=...` when submitted. Try searching "invoice" — confirm results page shows matching conversations with snippets.

- [ ] **Step 4: Verify chat**

Navigate to `/chat` — confirm:
- Suggested questions render and clicking one sends the message
- A streaming response appears (even if "I couldn't find any relevant emails" — that's correct if inbox is empty)
- Response renders with markdown (links are clickable)

- [ ] **Step 5: Verify AppRail icons**

Confirm chat icon and search icon appear in the sidebar on all pages that use `AppRail`.

- [ ] **Step 6: Final commit**

```bash
git add .
git commit -m "feat: Phase 3 v3.2 complete — NL search and Ask My Inbox chat"
```

---

## Phase 3 Complete Checklist

After all three plans (v3.0, v3.1, v3.2) are implemented:

- [ ] `npm test` — all tests pass
- [ ] `npm run build` — no TypeScript or build errors
- [ ] VIP contacts can be added in settings and appear as ⭐ in inbox
- [ ] Phishing warning banner shows on suspicious emails with "Mark as safe" working
- [ ] Unsubscribe button visible on marketing emails and archives conversation on click
- [ ] Life Admin tab in inbox shows bill/travel/medical conversations
- [ ] Snooze button on inbox rows and conversation page works; Snoozed tab shows snoozed items
- [ ] AttachmentsPanel shows on conversation pages with attachments
- [ ] SecondBrainPanel shows known facts about contacts
- [ ] `/search?q=invoice` returns matching conversations
- [ ] `/chat` responds to questions with streamed answers citing email sources
