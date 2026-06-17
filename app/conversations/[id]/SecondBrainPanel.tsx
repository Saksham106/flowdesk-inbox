// app/conversations/[id]/SecondBrainPanel.tsx
import type { ExtractedFact } from "@/lib/agent/second-brain"

const FACT_LABELS: Record<string, string> = {
  birthday: "Birthday",
  dietary: "Dietary",
  role: "Role",
  company: "Company",
  phone: "Phone",
}

export default function SecondBrainPanel({ facts }: { facts: ExtractedFact[] }) {
  if (facts.length === 0) return null
  return (
    <section className="rounded-lg border border-violet-100 bg-violet-50 p-3">
      <h3 className="mb-2 text-xs font-semibold text-violet-800">Known Facts</h3>
      <ul className="space-y-1">
        {facts.map((f) => (
          <li key={f.key} className="text-xs text-slate-700">
            <span className="font-medium text-violet-700">{FACT_LABELS[f.key] ?? f.key}:</span>{" "}
            {f.value}
          </li>
        ))}
      </ul>
    </section>
  )
}
