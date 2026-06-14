import { describe, expect, it, vi } from "vitest";

import {
  buildConversationHref,
  getAuthSuccessPath,
  getSafeInboxReturnPath,
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

describe("conversation inbox return links", () => {
  it("preserves the current inbox filter in conversation hrefs", () => {
    expect(buildConversationHref("conv-1", "/inbox?status=needs_reply&q=vip")).toBe(
      "/conversations/conv-1?returnTo=%2Finbox%3Fstatus%3Dneeds_reply%26q%3Dvip"
    );
  });

  it("only allows inbox return paths", () => {
    expect(getSafeInboxReturnPath("/inbox?status=closed")).toBe("/inbox?status=closed");
    expect(getSafeInboxReturnPath("/settings")).toBe("/inbox");
    expect(getSafeInboxReturnPath("https://example.com/inbox?status=needs_reply")).toBe(
      "/inbox?status=needs_reply"
    );
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
        { label: "Risk Radar", href: "/risk-radar" },
        { label: "Reports", href: "/reports" },
        { label: "Meetings", href: "/meetings" },
        { label: "Knowledge Base", href: "/knowledge-base" },
        { label: "Audit", href: "/audit" },
        { label: "Settings", href: "/settings" },
      ],
    });
  });

  it("defaults unknown account types to the personal-safe navigation", () => {
    expect(getInboxNavigation("unknown")).toEqual(getInboxNavigation("personal"));
  });
});
