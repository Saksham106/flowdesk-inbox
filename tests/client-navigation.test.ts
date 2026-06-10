import { describe, expect, it, vi } from "vitest";

import {
  getAuthSuccessPath,
  scrollToLandingSection,
} from "@/lib/client-navigation";

describe("getAuthSuccessPath", () => {
  it("uses the local inbox route even when NextAuth returns a stale absolute URL", () => {
    expect(
      getAuthSuccessPath("https://flowdesk-inbox-production.up.railway.app/inbox")
    ).toBe("/inbox");
  });

  it("preserves local relative success URLs", () => {
    expect(getAuthSuccessPath("/inbox?welcome=1")).toBe("/inbox?welcome=1");
  });
});

describe("scrollToLandingSection", () => {
  it("scrolls to a landing section without leaving a hash entry in history", () => {
    const scrollIntoView = vi.fn();
    const replaceState = vi.fn();
    const element = { scrollIntoView } as unknown as HTMLElement;
    const doc = {
      getElementById: vi.fn(() => element),
    } as unknown as Document;
    const history = { replaceState } as unknown as History;

    expect(scrollToLandingSection("#pricing", doc, history)).toBe(true);

    expect(doc.getElementById).toHaveBeenCalledWith("pricing");
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(replaceState).toHaveBeenCalledWith(null, "", "/");
  });
});
