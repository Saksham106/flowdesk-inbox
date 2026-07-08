import Link from "next/link"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { salesCrmEnabled } from "@/lib/tenant-capabilities"
import KbUrlImport from "@/app/knowledge-base/KbUrlImport"
import KbDocList from "@/app/knowledge-base/KbDocList"

export const dynamic = "force-dynamic"

export default async function KnowledgeBasePage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.user.tenantId },
    select: { salesCrmEnabled: true },
  })
  if (!salesCrmEnabled(tenant)) redirect("/home")

  const docs = await prisma.knowledgeDocument.findMany({
    where: { tenantId: session.user.tenantId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      content: true,
      sourceType: true,
      sourceUrl: true,
      createdAt: true,
    },
  })

  const serializedDocs = docs.map((d) => ({
    ...d,
    createdAt: d.createdAt.toISOString(),
  }))

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-3xl px-6 py-4">
          <Link href="/settings" className="text-sm text-slate-500 hover:text-slate-700">
            ← Back to settings
          </Link>
          <h1 className="mt-1 text-xl font-semibold">Knowledge Base</h1>
          <p className="text-sm text-slate-500">
            {docs.length} document{docs.length === 1 ? "" : "s"} · used when drafting replies
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        <KbUrlImport />

        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Your documents</h2>
          <KbDocList initialDocs={serializedDocs} />
        </section>
      </main>
    </div>
  )
}
