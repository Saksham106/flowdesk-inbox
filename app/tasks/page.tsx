import Link from "next/link"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export default async function TasksPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")

  const tasks = await prisma.inboxTask.findMany({
    where: { tenantId: session.user.tenantId, status: "open" },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    include: {
      conversation: {
        include: { contact: true },
      },
    },
    take: 200,
  })

  const overdue = tasks.filter((t) => t.dueAt && t.dueAt < new Date())
  const upcoming = tasks.filter((t) => t.dueAt && t.dueAt >= new Date())
  const noDueDate = tasks.filter((t) => !t.dueAt)

  function TaskRow({ task }: { task: (typeof tasks)[number] }) {
    const displayName =
      task.conversation.contact?.name ?? task.conversation.externalThreadId
    return (
      <li className="flex items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900">{task.title}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">{displayName}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {task.dueAt ? (
            <span
              className={`text-xs ${
                task.dueAt < new Date()
                  ? "font-semibold text-red-600"
                  : "text-slate-500"
              }`}
            >
              {task.dueAt.toLocaleDateString()}
            </span>
          ) : null}
          <Link
            href={`/conversations/${task.conversationId}`}
            className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            View →
          </Link>
        </div>
      </li>
    )
  }

  function Section({
    title,
    items,
    emptyText,
  }: {
    title: string
    items: typeof tasks
    emptyText: string
  }) {
    return (
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">{title}</h2>
        {items.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400 shadow-sm">
            {emptyText}
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <ul className="divide-y divide-slate-100">
              {items.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </ul>
          </div>
        )}
      </section>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/inbox" className="text-sm text-slate-500 hover:text-slate-700">
              ← Back to inbox
            </Link>
            <h1 className="mt-1 text-xl font-semibold">Tasks</h1>
            <p className="text-sm text-slate-500">
              {tasks.length} open task{tasks.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <Section
          title="Overdue"
          items={overdue}
          emptyText="No overdue tasks."
        />
        <Section
          title="Upcoming"
          items={upcoming}
          emptyText="No upcoming tasks with due dates."
        />
        <Section
          title="No due date"
          items={noDueDate}
          emptyText="No undated tasks."
        />
      </main>
    </div>
  )
}
