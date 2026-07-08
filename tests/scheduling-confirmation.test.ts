import { describe, it, expect } from "vitest"

import {
  detectSchedulingConfirmation,
  stripQuotedReply,
  type ProposedSlot,
} from "@/lib/agent/scheduling"

const SLOT_MON: ProposedSlot = {
  start: "2026-07-13T14:00:00.000Z",
  end: "2026-07-13T14:30:00.000Z",
  label: "Monday, Jul 13 at 10:00 AM",
}
const SLOT_TUE: ProposedSlot = {
  start: "2026-07-14T15:00:00.000Z",
  end: "2026-07-14T15:30:00.000Z",
  label: "Tuesday, Jul 14 at 11:00 AM",
}
const SLOT_TUE_PM: ProposedSlot = {
  start: "2026-07-14T19:00:00.000Z",
  end: "2026-07-14T19:30:00.000Z",
  label: "Tuesday, Jul 14 at 3:00 PM",
}

describe("stripQuotedReply", () => {
  it("drops quoted history after an attribution line", () => {
    const body = "Tuesday works for me!\n\nOn Mon, Jul 13, 2026 at 9:00 AM Sam <sam@x.com> wrote:\n> can we find a time Tuesday or Wednesday?"
    expect(stripQuotedReply(body)).toBe("Tuesday works for me!\n")
  })

  it("drops >-quoted lines even without an attribution line", () => {
    const body = "Sounds good.\n> are you available Tuesday at 11?"
    expect(stripQuotedReply(body)).toBe("Sounds good.")
  })
})

describe("detectSchedulingConfirmation", () => {
  it("confirms a bare affirmative when exactly one slot was proposed", () => {
    expect(detectSchedulingConfirmation("Yes, that works for me!", [SLOT_TUE])).toEqual(SLOT_TUE)
    expect(detectSchedulingConfirmation("Sounds good, see you then.", [SLOT_MON])).toEqual(SLOT_MON)
    expect(detectSchedulingConfirmation("Perfect, book it.", [SLOT_MON])).toEqual(SLOT_MON)
  })

  it("does not confirm a bare affirmative when several slots were proposed", () => {
    expect(detectSchedulingConfirmation("That works for me!", [SLOT_MON, SLOT_TUE])).toBeNull()
  })

  it("picks the slot whose weekday is mentioned", () => {
    expect(
      detectSchedulingConfirmation("Tuesday works best for me.", [SLOT_MON, SLOT_TUE])
    ).toEqual(SLOT_TUE)
    expect(
      detectSchedulingConfirmation("Let's do Monday.", [SLOT_MON, SLOT_TUE])
    ).toEqual(SLOT_MON)
  })

  it("disambiguates same-weekday slots by time", () => {
    const slots = [SLOT_TUE, SLOT_TUE_PM]
    expect(detectSchedulingConfirmation("Tuesday at 3 PM works.", slots)).toEqual(SLOT_TUE_PM)
    expect(detectSchedulingConfirmation("Tuesday at 11:00 AM works.", slots)).toEqual(SLOT_TUE)
    // Weekday alone is ambiguous across two Tuesday slots
    expect(detectSchedulingConfirmation("Tuesday works.", slots)).toBeNull()
  })

  it("picks a slot by ordinal or option number", () => {
    expect(
      detectSchedulingConfirmation("The second one works for me.", [SLOT_MON, SLOT_TUE])
    ).toEqual(SLOT_TUE)
    expect(
      detectSchedulingConfirmation("Yes — option 1 works.", [SLOT_MON, SLOT_TUE])
    ).toEqual(SLOT_MON)
  })

  it("never confirms a decline or counter-proposal", () => {
    expect(detectSchedulingConfirmation("Monday doesn't work for me.", [SLOT_MON])).toBeNull()
    expect(detectSchedulingConfirmation("I can't make Tuesday, sorry.", [SLOT_TUE])).toBeNull()
    expect(detectSchedulingConfirmation("None of these work.", [SLOT_MON, SLOT_TUE])).toBeNull()
    expect(
      detectSchedulingConfirmation("How about Thursday instead?", [SLOT_MON, SLOT_TUE])
    ).toBeNull()
    expect(
      detectSchedulingConfirmation("Can we do a different time?", [SLOT_TUE])
    ).toBeNull()
  })

  it("does not confirm ordinary replies with no affirmative signal", () => {
    expect(
      detectSchedulingConfirmation("Thanks for sending those over, I'll check my calendar.", [SLOT_MON])
    ).toBeNull()
    expect(detectSchedulingConfirmation("Who else will join the call?", [SLOT_MON])).toBeNull()
  })

  it("ignores slot mentions that only appear in quoted history", () => {
    const body =
      "None of these work, sorry.\n\nOn Mon, Jul 13, 2026 at 9:00 AM Ana wrote:\n> Tuesday at 11:00 AM works — want me to book it?"
    expect(detectSchedulingConfirmation(body, [SLOT_MON, SLOT_TUE])).toBeNull()
  })

  it("returns null when no slots were proposed", () => {
    expect(detectSchedulingConfirmation("Sounds good!", [])).toBeNull()
  })
})
