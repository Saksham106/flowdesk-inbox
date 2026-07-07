import { describe, expect, it } from "vitest"

import { detectAttachments } from "@/lib/agent/attachment-extractor"
import { detectSchedulingRequest } from "@/lib/agent/scheduling"
import { buildTsQuery } from "@/lib/agent/search"

describe("agent utility helpers", () => {
  it("builds Postgres tsquery strings from user search input", () => {
    expect(buildTsQuery("invoice")).toBe("invoice:*")
    expect(buildTsQuery("meeting tomorrow")).toBe("meeting:* & tomorrow:*")
    expect(buildTsQuery("invoice @#$%")).toBe("invoice:*")
    expect(buildTsQuery("  hello  world  ")).toBe("hello:* & world:*")
    expect(buildTsQuery("")).toBe("")
    expect(buildTsQuery("@#$%")).toBe("")
  })

  it("detects scheduling requests without matching ordinary email", () => {
    expect(detectSchedulingRequest("Following up", "Hey, can we schedule a call this week?")).toBe(true)
    expect(detectSchedulingRequest("Meeting", "Would love to find a time to connect.")).toBe(true)
    expect(detectSchedulingRequest("Quick chat", "Are you available for a 30-minute chat on Thursday?")).toBe(true)
    expect(detectSchedulingRequest("Invoice attached", "Please find attached invoice #1234.")).toBe(false)
    expect(detectSchedulingRequest("Calendar invite", "You have been invited to a meeting.")).toBe(false)
  })

  it("detects common attachment headers", () => {
    const pdf = `
Content-Type: multipart/mixed; boundary="boundary123"

--boundary123
Content-Type: application/pdf
Content-Disposition: attachment; filename="invoice.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQK

--boundary123--
`
    const image = `
Content-Type: image/png
Content-Disposition: attachment; filename="photo.png"
`

    expect(detectAttachments(pdf)).toMatchObject([
      { filename: "invoice.pdf", mimeType: "application/pdf" },
    ])
    expect(detectAttachments(image)).toMatchObject([
      { filename: "photo.png", mimeType: "image/png" },
    ])
    expect(detectAttachments("Just a plain text email body")).toHaveLength(0)
  })
})

