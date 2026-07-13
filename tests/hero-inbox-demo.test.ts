import { describe, expect, it } from "vitest";
import {
  HERO_ROWS,
  TIMELINE,
  counterAt,
  rowStateAt,
} from "@/app/components/landing/heroInboxData";

describe("hero inbox timeline", () => {
  it("p=0 is fully messy: no chips, nothing archived, all bold, nothing typed", () => {
    for (const row of HERO_ROWS) {
      const s = rowStateAt(0, row);
      expect(s.chipsVisible).toBe(false);
      expect(s.archived).toBe(false);
      expect(s.bold).toBe(true);
      expect(s.typedChars).toBe(0);
    }
    expect(counterAt(0)).toBe("1–50 of 5,918");
  });

  it("p=1 is fully organized: chips on kept rows, junk archived, draft fully typed", () => {
    for (const row of HERO_ROWS) {
      const s = rowStateAt(1, row);
      if (row.junk) {
        expect(s.archived).toBe(true);
        expect(s.chipsVisible).toBe(false);
      } else {
        expect(s.archived).toBe(false);
        expect(s.chipsVisible).toBe(true);
        expect(s.bold).toBe(!!row.boldAfter);
      }
      if (row.draft) expect(s.typedChars).toBe(row.snippet.length);
    }
    expect(counterAt(1)).toBe("1–12 of 12");
  });

  it("rest position shows the finished state (draft typed, junk archived)", () => {
    const p = TIMELINE.restAt;
    const draft = HERO_ROWS.find((r) => r.draft)!;
    expect(rowStateAt(p, draft).typedChars).toBe(draft.snippet.length);
    for (const row of HERO_ROWS.filter((r) => r.junk)) {
      expect(rowStateAt(p, row).archived).toBe(true);
    }
    expect(counterAt(p)).toBe("1–12 of 12");
  });

  it("labeling is staggered top-to-bottom within the label window", () => {
    const kept = HERO_ROWS.filter((r) => !r.draft);
    for (let i = 1; i < kept.length; i++) {
      expect(kept[i].labelAt).toBeGreaterThanOrEqual(kept[i - 1].labelAt);
    }
    for (const row of kept) {
      expect(row.labelAt).toBeGreaterThanOrEqual(TIMELINE.labelStart);
      expect(row.labelAt).toBeLessThanOrEqual(TIMELINE.labelEnd);
    }
  });

  it("archiving is staggered: mid-window some junk is archived and some is not", () => {
    const junk = HERO_ROWS.filter((r) => r.junk);
    expect(junk.length).toBeGreaterThanOrEqual(3);
    const mid = (junk[0].archiveAt! + junk[junk.length - 1].archiveAt!) / 2;
    const archivedCount = junk.filter((r) => rowStateAt(mid, r).archived).length;
    expect(archivedCount).toBeGreaterThan(0);
    expect(archivedCount).toBeLessThan(junk.length);
  });

  it("draft typing only happens inside the typing window", () => {
    const draft = HERO_ROWS.find((r) => r.draft)!;
    expect(rowStateAt(TIMELINE.typeStart, draft).typedChars).toBe(0);
    const midTyped = rowStateAt(
      (TIMELINE.typeStart + TIMELINE.typeEnd) / 2,
      draft
    ).typedChars;
    expect(midTyped).toBeGreaterThan(0);
    expect(midTyped).toBeLessThan(draft.snippet.length);
  });

  it("counter interpolates monotonically", () => {
    const totals: number[] = [];
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const m = counterAt(p).match(/of ([\d,]+)$/)!;
      totals.push(Number(m[1].replace(/,/g, "")));
    }
    for (let i = 1; i < totals.length; i++) {
      expect(totals[i]).toBeLessThanOrEqual(totals[i - 1]);
    }
  });
});
