import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockSessionFindFirst,
  mockSessionUpdate,
  mockMessageFindFirst,
  mockConvFindFirst,
  mockHoldFindFirst,
  mockProfileFindUnique,
  mockApprovalFindFirst,
  mockApprovalCreate,
  mockAutopilotFindUnique,
  mockAuditCreate,
  mockGetCalendarClient,
  mockCreateCalendarEvent,
  mockConfirmCalendarHold,
  mockCancelCalendarHold,
} = vi.hoisted(() => ({
  mockSessionFindFirst: vi.fn(),
  mockSessionUpdate: vi.fn(),
  mockMessageFindFirst: vi.fn(),
  mockConvFindFirst: vi.fn(),
  mockHoldFindFirst: vi.fn(),
  mockProfileFindUnique: vi.fn(),
  mockApprovalFindFirst: vi.fn(),
  mockApprovalCreate: vi.fn(),
  mockAutopilotFindUnique: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockGetCalendarClient: vi.fn(),
  mockCreateCalendarEvent: vi.fn(),
  mockConfirmCalendarHold: vi.fn(),
  mockCancelCalendarHold: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    schedulingSession: { findFirst: mockSessionFindFirst, update: mockSessionUpdate },
    message: { findFirst: mockMessageFindFirst },
    conversation: { findFirst: mockConvFindFirst },
    calendarHold: { findFirst: mockHoldFindFirst },
    businessProfile: { findUnique: mockProfileFindUnique },
    approvalRequest: { findFirst: mockApprovalFindFirst, create: mockApprovalCreate },
    autopilotSetting: { findUnique: mockAutopilotFindUnique },
    auditLog: { create: mockAuditCreate },
  },
}))

vi.mock("@/lib/google", () => ({
  getCalendarClient: mockGetCalendarClient,
  createCalendarEvent: mockCreateCalendarEvent,
  extractEmail: (raw: string) => raw.match(/<([^>]+)>/)?.[1] ?? raw,
}))

vi.mock("@/lib/agent/calendar-hold", () => ({
  confirmCalendarHold: mockConfirmCalendarHold,
  cancelCalendarHold: mockCancelCalendarHold,
}))

import {
  bookSchedulingSession,
  ensureBookingApprovalRequest,
  handleSchedulingConfirmationForInboundReply,
} from "@/lib/agent/scheduling-booking"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT = "tenant-1"
const CONV = "conv-1"
const SESSION = "sched-1"
const CAL = "owner@example.com"
const START = "2026-07-14T15:00:00.000Z"
const END = "2026-07-14T15:30:00.000Z"

const SLOT = { start: START, end: END, label: "Tuesday, Jul 14 at 11:00 AM" }

const confirmedSession = {
  id: SESSION,
  tenantId: TENANT,
  conversationId: CONV,
  status: "confirmed",
  proposedTimesJson: [SLOT],
  confirmedTime: START,
  calendarEmail: CAL,
  eventId: null,
  lastBookingError: null,
  lastBookingAttemptAt: null,
}

function resetHappyPath() {
  vi.clearAllMocks()
  mockSessionFindFirst.mockResolvedValue({ ...confirmedSession })
  mockSessionUpdate.mockImplementation(async ({ data }) => ({ ...confirmedSession, ...data }))
  mockMessageFindFirst.mockResolvedValue({
    subject: "Catch up",
    fromE164: "Sam Doe <sam@example.com>",
  })
  mockConvFindFirst.mockResolvedValue({ contact: { name: "Sam Doe" } })
  mockHoldFindFirst.mockResolvedValue(null)
  mockProfileFindUnique.mockResolvedValue({ primaryCalendarEmail: CAL })
  mockGetCalendarClient.mockResolvedValue({})
  mockCreateCalendarEvent.mockResolvedValue({ id: "evt-real" })
  mockAuditCreate.mockResolvedValue({})
  mockApprovalFindFirst.mockResolvedValue(null)
  mockApprovalCreate.mockResolvedValue({ id: "appr-1" })
}

// ---------------------------------------------------------------------------
// bookSchedulingSession — state transitions
// ---------------------------------------------------------------------------

describe("bookSchedulingSession", () => {
  beforeEach(resetHappyPath)

  it("books a confirmed session: creates the event, marks booked, audits", async () => {
    const result = await bookSchedulingSession({ tenantId: TENANT, conversationId: CONV, trigger: "user" })

    expect(result.ok).toBe(true)
    expect(mockCreateCalendarEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "confirmed",
        attendeeEmails: ["sam@example.com"],
        start: new Date(START),
        end: new Date(END),
      })
    )
    expect(mockSessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "booked", eventId: "evt-real", lastBookingError: null }),
      })
    )
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "scheduling_session.booked",
          payloadJson: expect.objectContaining({ trigger: "user", holdConverted: false }),
        }),
      })
    )
  })

  it("converts an active hold at the agreed time instead of creating a duplicate event", async () => {
    mockHoldFindFirst.mockResolvedValue({
      id: "hold-1",
      externalEventId: "evt-hold",
      startAt: new Date(START),
    })

    const result = await bookSchedulingSession({ tenantId: TENANT, conversationId: CONV, trigger: "approval" })

    expect(result.ok).toBe(true)
    expect(mockConfirmCalendarHold).toHaveBeenCalledWith("hold-1", TENANT)
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled()
    expect(mockSessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "booked", eventId: "evt-hold" }),
      })
    )
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: expect.objectContaining({ holdConverted: true }),
        }),
      })
    )
  })

  it("cancels a stale hold at a different time and books the real event", async () => {
    mockHoldFindFirst.mockResolvedValue({
      id: "hold-stale",
      externalEventId: "evt-stale",
      startAt: new Date("2026-07-15T09:00:00.000Z"),
    })

    const result = await bookSchedulingSession({ tenantId: TENANT, conversationId: CONV, trigger: "user" })

    expect(result.ok).toBe(true)
    expect(mockCancelCalendarHold).toHaveBeenCalledWith("hold-stale", TENANT)
    expect(mockCreateCalendarEvent).toHaveBeenCalled()
  })

  it("records the error and keeps the session confirmed when the calendar API fails", async () => {
    mockCreateCalendarEvent.mockRejectedValue(new Error("insufficient permissions"))

    const result = await bookSchedulingSession({ tenantId: TENANT, conversationId: CONV, trigger: "auto" })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("insufficient permissions")
    expect(mockSessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastBookingError: "insufficient permissions",
          lastBookingAttemptAt: expect.any(Date),
        }),
      })
    )
    // status is never touched on failure — the session is not stranded
    const updateData = mockSessionUpdate.mock.calls[0][0].data
    expect(updateData.status).toBeUndefined()
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "scheduling_session.booking_failed" }),
      })
    )
  })

  it("fails without touching the calendar when no booking calendar is configured", async () => {
    mockSessionFindFirst.mockResolvedValue({ ...confirmedSession, calendarEmail: null })
    mockProfileFindUnique.mockResolvedValue(null)

    const result = await bookSchedulingSession({ tenantId: TENANT, conversationId: CONV, trigger: "user" })

    expect(result.ok).toBe(false)
    expect(mockGetCalendarClient).not.toHaveBeenCalled()
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled()
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "scheduling_session.booking_failed" }),
      })
    )
  })

  it("is idempotent for an already-booked session", async () => {
    mockSessionFindFirst.mockResolvedValue({ ...confirmedSession, status: "booked", eventId: "evt-x" })

    const result = await bookSchedulingSession({ tenantId: TENANT, conversationId: CONV, trigger: "user" })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.alreadyBooked).toBe(true)
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled()
    expect(mockSessionUpdate).not.toHaveBeenCalled()
  })

  it("refuses to book without a confirmed time", async () => {
    mockSessionFindFirst.mockResolvedValue({ ...confirmedSession, confirmedTime: null })

    const result = await bookSchedulingSession({ tenantId: TENANT, conversationId: CONV, trigger: "user" })

    expect(result.ok).toBe(false)
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled()
  })

  it("scopes the session lookup to the tenant", async () => {
    mockSessionFindFirst.mockResolvedValue(null)

    const result = await bookSchedulingSession({ tenantId: "other-tenant", conversationId: CONV, trigger: "user" })

    expect(result.ok).toBe(false)
    expect(mockSessionFindFirst.mock.calls[0][0].where.tenantId).toBe("other-tenant")
  })
})

// ---------------------------------------------------------------------------
// ensureBookingApprovalRequest
// ---------------------------------------------------------------------------

describe("ensureBookingApprovalRequest", () => {
  beforeEach(resetHappyPath)

  it("creates a pending book_event approval with the slot metadata and audits", async () => {
    await ensureBookingApprovalRequest({
      tenantId: TENANT,
      conversationId: CONV,
      sessionId: SESSION,
      slot: SLOT,
      calendarEmail: CAL,
    })

    expect(mockApprovalCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          step: "book_event",
          metadataJson: expect.objectContaining({ source: "scheduling", start: START }),
        }),
      })
    )
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "scheduling_session.booking_approval_requested" }),
      })
    )
  })

  it("is idempotent while a pending request exists", async () => {
    mockApprovalFindFirst.mockResolvedValue({ id: "appr-existing" })

    const approval = await ensureBookingApprovalRequest({
      tenantId: TENANT,
      conversationId: CONV,
      sessionId: SESSION,
      slot: SLOT,
      calendarEmail: CAL,
    })

    expect(approval.id).toBe("appr-existing")
    expect(mockApprovalCreate).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// handleSchedulingConfirmationForInboundReply — the automated transition
// ---------------------------------------------------------------------------

describe("handleSchedulingConfirmationForInboundReply", () => {
  beforeEach(() => {
    resetHappyPath()
    mockSessionFindFirst.mockResolvedValue({
      ...confirmedSession,
      status: "proposing",
      confirmedTime: null,
    })
  })

  it("confirms the session and raises an approval below Level 5", async () => {
    mockAutopilotFindUnique.mockResolvedValue({ automationLevel: 3 })

    await handleSchedulingConfirmationForInboundReply({
      tenantId: TENANT,
      conversationId: CONV,
      inboundBody: "Tuesday at 11 AM works for me!",
    })

    expect(mockSessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "confirmed", confirmedTime: START },
      })
    )
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "scheduling_session.confirmed",
          payloadJson: expect.objectContaining({ detectedFrom: "inbound_reply" }),
        }),
      })
    )
    expect(mockApprovalCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ step: "book_event" }) })
    )
    // Never auto-books below Level 5
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled()
  })

  it("auto-books at Level 5", async () => {
    mockAutopilotFindUnique.mockResolvedValue({ automationLevel: 5 })
    // After the confirm update, booking re-reads the session
    mockSessionFindFirst
      .mockResolvedValueOnce({ ...confirmedSession, status: "proposing", confirmedTime: null })
      .mockResolvedValueOnce({ ...confirmedSession })

    await handleSchedulingConfirmationForInboundReply({
      tenantId: TENANT,
      conversationId: CONV,
      inboundBody: "Yes, Tuesday works — see you then.",
    })

    expect(mockApprovalCreate).not.toHaveBeenCalled()
    expect(mockCreateCalendarEvent).toHaveBeenCalled()
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "scheduling_session.booked",
          payloadJson: expect.objectContaining({ trigger: "auto" }),
        }),
      })
    )
  })

  it("does nothing when the reply is not a confirmation", async () => {
    mockAutopilotFindUnique.mockResolvedValue({ automationLevel: 5 })

    await handleSchedulingConfirmationForInboundReply({
      tenantId: TENANT,
      conversationId: CONV,
      inboundBody: "How about Thursday instead?",
    })

    expect(mockSessionUpdate).not.toHaveBeenCalled()
    expect(mockApprovalCreate).not.toHaveBeenCalled()
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled()
  })

  it("does nothing when there is no proposing session", async () => {
    mockSessionFindFirst.mockResolvedValue(null)

    await handleSchedulingConfirmationForInboundReply({
      tenantId: TENANT,
      conversationId: CONV,
      inboundBody: "Sounds good!",
    })

    expect(mockSessionUpdate).not.toHaveBeenCalled()
  })
})
