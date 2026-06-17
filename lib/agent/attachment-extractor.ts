export type DetectedAttachment = {
  filename: string
  mimeType: string
  base64Data?: string
}

const CONTENT_TYPE_PATTERN = /Content-Type:\s*([\w\/]+)/gi
const CONTENT_DISPOSITION_PATTERN = /Content-Disposition:\s*attachment;\s*filename=["']?([^"'\r\n;]+)["']?/gi

export function detectAttachments(rawEmailBody: string): DetectedAttachment[] {
  const attachments: DetectedAttachment[] = []

  // Find all Content-Disposition: attachment headers
  const dispositionRegex = new RegExp(CONTENT_DISPOSITION_PATTERN.source, "gi")
  let dispMatch: RegExpExecArray | null

  while ((dispMatch = dispositionRegex.exec(rawEmailBody)) !== null) {
    const filename = dispMatch[1].trim()

    // Look backwards from this position for the nearest Content-Type header
    const before = rawEmailBody.substring(0, dispMatch.index)
    const contentTypeMatches = [...before.matchAll(new RegExp(CONTENT_TYPE_PATTERN.source, "gi"))]
    const lastContentType = contentTypeMatches[contentTypeMatches.length - 1]
    const mimeType = lastContentType ? lastContentType[1] : "application/octet-stream"

    // Extract base64 data if present (look for base64-like block after the header pair)
    const afterHeader = rawEmailBody.substring(dispMatch.index + dispMatch[0].length)
    const base64Match = afterHeader.match(/Content-Transfer-Encoding:\s*base64\s*\n+([A-Za-z0-9+/\n=]+)/)
    const base64Data = base64Match ? base64Match[1].replace(/\n/g, "") : undefined

    attachments.push({ filename, mimeType, base64Data })
  }

  return attachments
}

export async function extractPdfText(base64Data: string): Promise<string> {
  // Dynamic import to avoid issues at module load time
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = (await import("pdf-parse")) as any
  const pdfParse = mod.default ?? mod
  const buffer = Buffer.from(base64Data, "base64")
  const result = await pdfParse(buffer)
  return result.text.slice(0, 5000) // cap at 5000 chars
}
