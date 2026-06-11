import { describe, expect, it, vi } from "vitest";

import {
  getAuthSuccessPath,
  scrollToLandingSection,
} from "@/lib/client-navigation";
import { getInboxNavigation } from "@/lib/app-navigation";

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

describe("getInboxNavigation", () => {
  it("keeps personal account navigation focused on personal inbox work", () => {
    expect(getInboxNavigation("personal")).toEqual({
      primary: [
        { label: "Digest", href: "/digest" },
        { label: "Tasks", href: "/tasks" },
        { label: "Settings", href: "/settings" },
      ],
      secondary: [],
    });
  });

  it("groups business-only tools behind secondary navigation", () => {
    expect(getInboxNavigation("business")).toEqual({
      primary: [
        { label: "Digest", href: "/digest" },
        { label: "Tasks", href: "/tasks" },
      ],
      secondary: [
        { label: "Leads", href: "/leads" },
        { label: "Approvals", href: "/approvals" },
        { label: "Reports", href: "/reports" },
        { label: "Meetings", href: "/meetings" },
        { label: "Audit", href: "/audit" },
        { label: "Settings", href: "/settings" },
      ],
    });
  });

  it("defaults unknown account types to the personal-safe navigation", () => {
    expect(getInboxNavigation("unknown")).toEqual(getInboxNavigation("personal"));
  });
});
