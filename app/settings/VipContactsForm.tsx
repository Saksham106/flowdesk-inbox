"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

type VipContact = {
  id: string
  email: string
  label: string | null
}

export default function VipContactsForm({ initialVips }: { initialVips: VipContact[] }) {
  const router = useRouter()
  const [vips, setVips] = useState<VipContact[]>(initialVips)
  const [email, setEmail] = useState("")
  const [label, setLabel] = useState("")
  const [saving, setSaving] = useState(false)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setSaving(true)
    const res = await fetch("/api/vip-contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), label: label.trim() || null }),
    })
    if (res.ok) {
      const { vip } = await res.json()
      setVips((prev) => [...prev, vip])
      setEmail("")
      setLabel("")
      router.refresh()
    }
    setSaving(false)
  }

  async function remove(id: string) {
    await fetch(`/api/vip-contacts/${id}`, { method: "DELETE" })
    setVips((prev) => prev.filter((v) => v.id !== id))
    router.refresh()
  }

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-slate-900">VIP Contacts</h2>
      <p className="text-xs text-slate-500">Emails from VIP contacts are always surfaced first with urgent priority.</p>
      <form onSubmit={add} className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@example.com"
          className="flex-1 rounded border border-slate-200 px-3 py-1.5 text-sm"
          required
        />
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          className="w-36 rounded border border-slate-200 px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          Add
        </button>
      </form>
      <ul className="space-y-1">
        {vips.map((v) => (
          <li key={v.id} className="flex items-center justify-between rounded border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
            <span>⭐ {v.email}{v.label ? ` — ${v.label}` : ""}</span>
            <button onClick={() => remove(v.id)} className="text-xs text-red-500 hover:underline">Remove</button>
          </li>
        ))}
        {vips.length === 0 && <li className="text-xs text-slate-400">No VIP contacts yet.</li>}
      </ul>
    </section>
  )
}
