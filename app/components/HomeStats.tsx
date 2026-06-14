interface StatPill {
  label: string
  value: number
  accent: "red" | "amber" | "blue" | "neutral" | "dim"
}

interface Props {
  pills: StatPill[]
}

const ACCENT_CLASSES: Record<StatPill["accent"], string> = {
  red: "text-red-600",
  amber: "text-amber-600",
  blue: "text-blue-600",
  neutral: "text-slate-700",
  dim: "text-slate-300",
}

export default function HomeStats({ pills }: Props) {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {pills.map(({ label, value, accent }) => (
        <div
          key={label}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5"
        >
          <span className={`text-base font-extrabold leading-none ${ACCENT_CLASSES[accent]}`}>
            {value}
          </span>
          <span className="text-[10px] font-medium text-slate-500">{label}</span>
        </div>
      ))}
    </div>
  )
}
