import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

const PRIVATE_IP_RE =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|::1)/i

function isPrivateHostname(hostname: string): boolean {
  return PRIVATE_IP_RE.test(hostname)
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  return match ? match[1].trim() : null
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const tenantId = session.user.tenantId
  const body = await request.json().catch(() => null)
  const rawUrl = typeof body?.url === "string" ? body.url.trim() : ""
  const rawTitle = typeof body?.title === "string" ? body.title.trim() : ""

  if (!rawUrl) {
    return NextResponse.json({ error: "url is required" }, { status: 400 })
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
  }

  if (parsed.protocol !== "https:") {
    return NextResponse.json(
      { error: "Only https:// URLs are supported" },
      { status: 400 }
    )
  }

  if (isPrivateHostname(parsed.hostname)) {
    return NextResponse.json(
      { error: "Private or loopback URLs are not allowed" },
      { status: 400 }
    )
  }

  let html: string
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    const upstream = await fetch(rawUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "FlowDesk/1.0 (content-importer)" },
    })
    clearTimeout(timer)
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream returned ${upstream.status}` },
        { status: 502 }
      )
    }
    html = await upstream.text()
  } catch {
    return NextResponse.json({ error: "Failed to fetch URL" }, { status: 502 })
  }

  const title = rawTitle || extractTitle(html) || parsed.hostname
  const content = stripHtml(html).slice(0, 8000)

  if (!content.trim()) {
    return NextResponse.json(
      { error: "No readable content found at that URL" },
      { status: 422 }
    )
  }

  const [document] = await prisma.$transaction([
    prisma.knowledgeDocument.create({
      data: {
        tenantId,
        title,
        content,
        sourceType: "webpage",
        sourceUrl: rawUrl,
        crawledAt: new Date(),
      },
    }),
    prisma.auditLog.create({
      data: {
        tenantId,
        userId: session.user.id,
        action: "knowledge_document.crawl",
        payloadJson: { url: rawUrl, title },
      },
    }),
  ])

  return NextResponse.json({ document }, { status: 201 })
}
