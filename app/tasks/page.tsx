import Link from "next/link"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"

import AppShell from "@/app/components/AppShell"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import TaskList from "./TaskList"

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

  const now = new Date()
  const overdue = tasks.filter((t) => t.dueAt && t.dueAt < now)
  const upcoming = tasks.filter((t) => t.dueAt && t.dueAt >= now)
  const noDueDate = tasks.filter((t) => !t.dueAt)

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
            <TaskList tasks={items} />
          </div>
        )}
      </section>
    )
  }

  return (
    <AppShell tenantId={session.user.tenantId}>
      <div className="min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <div>
              <Link href="/home" className="text-sm text-slate-500 hover:text-slate-700 lg:hidden">
                ← Back to inbox
              </Link>
              <h1 className="mt-1 font-serif text-2xl font-normal">Tasks</h1>
              <p className="text-sm text-slate-500">
                {tasks.length} open task{tasks.length === 1 ? "" : "s"}
                {overdue.length > 0 && (
                  <span className="ml-2 font-medium text-[var(--color-signal-ink)]">
                    · {overdue.length} overdue
                  </span>
                )}
              </p>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-6 py-8">
          <Section title="Overdue" items={overdue} emptyText="No overdue tasks." />
          <Section title="Upcoming" items={upcoming} emptyText="No upcoming tasks with due dates." />
          <Section title="No due date" items={noDueDate} emptyText="No undated tasks." />
        </main>
      </div>
    </AppShell>
  )
}
