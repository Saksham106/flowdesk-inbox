"use client"

import { useState, useRef, useEffect } from "react"

type Message = { role: "user" | "assistant"; content: string }

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const question = input.trim()
    if (!question || streaming) return

    const userMsg: Message = { role: "user", content: question }
    setMessages((prev) => [...prev, userMsg])
    setInput("")
    setStreaming(true)

    const assistantMsg: Message = { role: "assistant", content: "" }
    setMessages((prev) => [...prev, assistantMsg])

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          history: messages.slice(-10), // last 10 for context window
        }),
      })

      if (!res.ok || !res.body) {
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: "assistant", content: "Sorry, something went wrong." }
          return updated
        })
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const payload = line.slice(6)
          if (payload === "[DONE]") break
          try {
            const { text } = JSON.parse(payload)
            if (text) {
              setMessages((prev) => {
                const updated = [...prev]
                updated[updated.length - 1] = {
                  role: "assistant",
                  content: updated[updated.length - 1].content + text,
                }
                return updated
              })
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }
    } finally {
      setStreaming(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-sm text-slate-400 mt-16">
            <p className="text-2xl mb-2">💬</p>
            <p>Ask anything about your inbox</p>
            <p className="text-xs mt-1 text-slate-300">e.g. &ldquo;Any unpaid invoices?&rdquo; or &ldquo;What did John say last week?&rdquo;</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                m.role === "user"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-800"
              }`}
            >
              {m.content || (streaming && m.role === "assistant" ? <span className="animate-pulse">…</span> : "")}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={send} className="border-t border-slate-200 p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your inbox…"
            disabled={streaming}
            className="flex-1 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm focus:border-slate-400 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {streaming ? "…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  )
}
