import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { searchMessages } from "@/lib/agent/search"

export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const q = searchParams.get("q")?.trim() ?? ""
  if (!q) return NextResponse.json({ results: [] })

  const results = await searchMessages(session.user.tenantId, q, 20)
  return NextResponse.json({ results })
}
