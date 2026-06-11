type ConversationStateView = {
  state: string
  priority: string
  reason: string
  nextAction: string
  confidence: number
} | null

type InboxTaskView = {
  id: string
  title: string
  status: string
  dueAt: Date | null
}

type LeadView = {
  id: string
  name: string
  company: string | null
  need: string
  urgency: string
  budgetClue: string | null
  nextAction: string
  score: number
  stage: string
} | null

export default function WorkItemsPanel({
  state,
  tasks,
  lead,
}: {
  state: ConversationStateView
  tasks: InboxTaskView[]
  lead: LeadView
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-600">Work items</h2>
          <p className="mt-1 text-xs text-slate-500">
            Persisted state, tasks, and lead signals for this thread.
          </p>
        </div>
        {state ? (
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium capitalize text-slate-600">
            {state.priority}
          </span>
        ) : null}
      </div>

      {state ? (
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs">
          <p className="font-semibold capitalize text-slate-800">
            {state.state.replaceAll("_", " ")}
          </p>
          <p className="mt-1 text-slate-600">{state.reason}</p>
          <p className="mt-2 font-medium text-slate-700">{state.nextAction}</p>
          <p className="mt-2 text-slate-500">
            Confidence: {(state.confidence * 100).toFixed(0)}%
          </p>
        </div>
      ) : (
        <p className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-500">
          No persisted state yet.
        </p>
      )}

      {tasks.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-xs font-semibold text-slate-600">Tasks</h3>
          <ul className="mt-2 space-y-2">
            {tasks.map((task) => (
              <li key={task.id} className="rounded-lg border border-slate-100 px-3 py-2 text-xs">
                <p className="font-medium text-slate-800">{task.title}</p>
                <p className="mt-1 text-slate-500">
                  {task.dueAt ? `Due ${task.dueAt.toLocaleDateString()}` : "No due date"}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {lead ? (
        <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold text-blue-900">Lead</h3>
            <span className="rounded-full bg-white px-2 py-0.5 font-medium text-blue-700">
              {lead.score}
            </span>
          </div>
          <p className="mt-2 font-medium text-blue-950">
            {lead.company ?? lead.name}
          </p>
          <p className="mt-1 text-blue-800">{lead.need}</p>
          <p className="mt-2 text-blue-700">{lead.nextAction}</p>
          {lead.budgetClue ? (
            <p className="mt-2 text-blue-700">{lead.budgetClue}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
