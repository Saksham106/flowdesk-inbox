import { describe, it, expect } from "vitest"
import { detectAttachments, type DetectedAttachment } from "@/lib/agent/attachment-extractor"

describe("detectAttachments", () => {
  it("detects PDF attachment from Content-Disposition header pattern", () => {
    const rawEmail = `
Content-Type: multipart/mixed; boundary="boundary123"

--boundary123
Content-Type: application/pdf
Content-Disposition: attachment; filename="invoice.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQK

--boundary123--
`
    const result = detectAttachments(rawEmail)
    expect(result).toHaveLength(1)
    expect(result[0].filename).toBe("invoice.pdf")
    expect(result[0].mimeType).toBe("application/pdf")
  })

  it("detects image attachment", () => {
    const rawEmail = `
Content-Type: image/png
Content-Disposition: attachment; filename="photo.png"
`
    const result = detectAttachments(rawEmail)
    expect(result).toHaveLength(1)
    expect(result[0].filename).toBe("photo.png")
    expect(result[0].mimeType).toBe("image/png")
  })

  it("returns empty array when no attachments", () => {
    const result = detectAttachments("Just a plain text email body")
    expect(result).toHaveLength(0)
  })
})
