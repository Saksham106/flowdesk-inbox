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
    expect(buildConversationHref("conv-1", "/mail?status=needs_reply&q=vip")).toBe(
      "/conversations/conv-1?returnTo=%2Fmail%3Fstatus%3Dneeds_reply%26q%3Dvip"
    );
  });

  it("only allows mail return paths", () => {
    expect(getSafeInboxReturnPath("/mail?status=closed")).toBe("/mail?status=closed");
    expect(getSafeInboxReturnPath("/settings")).toBe("/mail");
    expect(getSafeInboxReturnPath("https://example.com/mail?status=needs_reply")).toBe(
      "/mail?status=needs_reply"
    );
  });
});

describe("getInboxNavigation (B2C: baseline + opt-in Sales & CRM)", () => {
  it("returns the baseline navigation when Sales & CRM is off", () => {
    expect(getInboxNavigation({ salesCrm: false })).toEqual({
      primary: [
        { label: "Mail", href: "/mail" },
        { label: "Assistant", href: "/assistant" },
        { label: "Approvals", href: "/approvals" },
        { label: "Clean", href: "/clean-inbox" },
        { label: "Settings", href: "/settings" },
      ],
      secondary: [
        { label: "Tasks", href: "/tasks" },
        { label: "Activity", href: "/audit" },
        { label: "Tools", href: "/tools" },
      ],
    });
  });

  it("adds the Sales & CRM cluster when the capability is enabled", () => {
    const secondary = getInboxNavigation({ salesCrm: true }).secondary.map((i) => i.href);
    expect(secondary).toEqual([
      "/tasks",
      "/audit",
      "/tools",
      "/leads",
      "/reports",
      "/risk-radar",
      "/meetings",
      "/knowledge-base",
    ]);
  });
});
