import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import TestRulesClient from "@/app/assistant/TestRulesClient"

export const dynamic = "force-dynamic"

export default async function AssistantTestRulesPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) redirect("/login")

  const rules = await prisma.agentRule.findMany({
    where: { tenantId: session.user.tenantId, status: { not: "dismissed" } },
    orderBy: { createdAt: "desc" },
  })

  const ruleOptions = rules.map((r) => ({
    id: r.id,
    label: r.plainText?.trim() || `${r.ruleType} rule (${r.id.slice(0, 8)})`,
  }))

  return <TestRulesClient rules={ruleOptions} />
}
