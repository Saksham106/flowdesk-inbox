"use client"

import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import type { BusinessProfile } from "@prisma/client"

const INDUSTRIES = [
  { value: "med_spa", label: "Med Spa" },
  { value: "dental", label: "Dental" },
  { value: "salon", label: "Salon" },
  { value: "wellness_clinic", label: "Wellness Clinic" },
  { value: "fitness_studio", label: "Fitness Studio" },
  { value: "home_services", label: "Home Services" },
  { value: "real_estate", label: "Real Estate" },
  { value: "other", label: "Other" },
]

const TIMEZONES = [
  { value: "America/New_York", label: "Eastern (America/New_York)" },
  { value: "America/Chicago", label: "Central (America/Chicago)" },
  { value: "America/Denver", label: "Mountain (America/Denver)" },
  { value: "America/Los_Angeles", label: "Pacific (America/Los_Angeles)" },
  { value: "America/Phoenix", label: "Arizona (America/Phoenix)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Pacific/Honolulu)" },
]

const TONES = [
  { value: "professional", label: "Professional" },
  { value: "friendly", label: "Friendly" },
  { value: "warm", label: "Warm" },
  { value: "concise", label: "Concise" },
]

export default function BusinessProfileForm({ initial }: { initial: BusinessProfile | null }) {
  const router = useRouter()
  const [businessName, setBusinessName] = useState(initial?.businessName ?? "")
  const [industry, setIndustry] = useState(initial?.industry ?? "med_spa")
  const [timezone, setTimezone] = useState(initial?.timezone ?? "America/New_York")
  const [defaultTone, setDefaultTone] = useState(initial?.defaultTone ?? "professional")
  const [bookingPolicy, setBookingPolicy] = useState(initial?.bookingPolicy ?? "")
  const [escalationPolicy, setEscalationPolicy] = useState(initial?.escalationPolicy ?? "")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    setError("")
    try {
      const res = await fetch("/api/business-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName,
          industry,
          timezone,
          defaultTone,
          bookingPolicy: bookingPolicy || null,
          escalationPolicy: escalationPolicy || null,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      setSaved(true)
      router.refresh()
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Business Name
        </label>
        <input
          type="text"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          required
          placeholder="e.g. Glow Med Spa"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Industry
          </label>
          <select
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          >
            {INDUSTRIES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Timezone
          </label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          >
            {TIMEZONES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Default Tone
        </label>
        <select
          value={defaultTone}
          onChange={(e) => setDefaultTone(e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
        >
          {TONES.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Booking Policy{" "}
          <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <textarea
          value={bookingPolicy}
          onChange={(e) => setBookingPolicy(e.target.value)}
          rows={3}
          placeholder="Describe your booking policy so the AI can reference it when answering questions…"
          className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Escalation Policy{" "}
          <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <textarea
          value={escalationPolicy}
          onChange={(e) => setEscalationPolicy(e.target.value)}
          rows={3}
          placeholder="Describe when and how to escalate conversations to a human…"
          className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
      >
        {saving ? "Saving…" : saved ? "Saved!" : "Save"}
      </button>
    </form>
  )
}
