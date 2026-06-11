import type { MeetingPrepResult } from "@/lib/ai/prompts/meeting-prep"

export default function MeetingBriefView({ brief }: { brief: MeetingPrepResult }) {
  return (
    <div className="mt-4 space-y-4 rounded-xl border border-slate-100 bg-slate-50 p-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Who they are</p>
        <p className="mt-1 text-sm text-slate-800">{brief.contactSummary}</p>
        <span className="mt-2 inline-block rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-medium text-slate-600">
          Tone: {brief.lastTone}
        </span>
      </div>

      {brief.whatTheyAskedAbout.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            What they asked about
          </p>
          <ul className="mt-1 space-y-1">
            {brief.whatTheyAskedAbout.map((item, i) => (
              <li key={i} className="text-sm text-slate-800">
                • {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {brief.talkingPoints.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Talking points
          </p>
          <ul className="mt-1 space-y-1">
            {brief.talkingPoints.map((item, i) => (
              <li key={i} className="text-sm text-slate-800">
                • {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {brief.openItems.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Open items
          </p>
          <ul className="mt-1 space-y-1">
            {brief.openItems.map((item, i) => (
              <li key={i} className="text-sm text-amber-700">
                • {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {brief.riskFlags.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Risk flags
          </p>
          <ul className="mt-1 space-y-1">
            {brief.riskFlags.map((item, i) => (
              <li key={i} className="text-sm text-red-700">
                • {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
