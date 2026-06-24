import { describe, it, expect } from "vitest";
import {
  isHtmlBody,
  sanitizeEmailHtml,
  sanitizeEmailHtmlForIframe,
  hasRemoteEmailImages,
  linkifyText,
  renderEmailBodyHtml,
  stripHtmlToText,
} from "@/lib/email-body";

describe("isHtmlBody", () => {
  it("detects DOCTYPE as HTML", () => {
    expect(isHtmlBody('<!DOCTYPE html PUBLIC "-//W3C//DTD...">')).toBe(true);
  });

  it("detects opening div tag as HTML", () => {
    expect(isHtmlBody("<div>hello</div>")).toBe(true);
  });

  it("detects html tag as HTML", () => {
    expect(isHtmlBody("<html><body>hi</body></html>")).toBe(true);
  });

  it("treats plain text as not HTML", () => {
    expect(isHtmlBody("Hello, here is your Google Doc link")).toBe(false);
  });

  it("treats empty string as not HTML", () => {
    expect(isHtmlBody("")).toBe(false);
  });

  it("ignores leading whitespace when detecting HTML", () => {
    expect(isHtmlBody("  \n<!DOCTYPE html>")).toBe(true);
  });

  it("detects HTML even with BOM prefix", () => {
    expect(isHtmlBody("﻿<!DOCTYPE html>")).toBe(true);
  });
});

describe("sanitizeEmailHtml", () => {
  it("strips script tags entirely", () => {
    const result = sanitizeEmailHtml("<p>Hello</p><script>alert(1)</script>");
    expect(result).not.toContain("<script");
    expect(result).not.toContain("alert(1)");
    expect(result).toContain("Hello");
  });

  it("strips event handler attributes", () => {
    const result = sanitizeEmailHtml('<img src="x.jpg" onerror="xss()">');
    expect(result).not.toContain("onerror");
  });

  it("strips iframe tags", () => {
    const result = sanitizeEmailHtml(
      '<p>text</p><iframe src="https://evil.com"></iframe>'
    );
    expect(result).not.toContain("<iframe");
  });

  it("enforces target=_blank on links", () => {
    const result = sanitizeEmailHtml(
      '<a href="https://example.com">click</a>'
    );
    expect(result).toContain('target="_blank"');
  });

  it("enforces rel=noopener noreferrer on links", () => {
    const result = sanitizeEmailHtml(
      '<a href="https://example.com">click</a>'
    );
    expect(result).toContain('rel="noopener noreferrer"');
  });

  it("preserves safe formatting tags", () => {
    const result = sanitizeEmailHtml("<p><strong>Bold</strong> and <em>italic</em></p>");
    expect(result).toContain("<strong>Bold</strong>");
    expect(result).toContain("<em>italic</em>");
  });

  it("preserves anchor href attribute", () => {
    const result = sanitizeEmailHtml(
      '<a href="https://docs.google.com/abc">open doc</a>'
    );
    expect(result).toContain('href="https://docs.google.com/abc"');
  });

  it("preserves complex HTML email hrefs without double-encoding query params", () => {
    const url =
      "https://tailscale.com/blog/ai-without-lock-in?utm_campaign=aperture-onboarding&utm_medium=email&_hsenc=p2ANqtz-8LQ1jYlpQDfPleiso5vWOj8eTTmQ6LmJQzUlsHvOLSHmZhE3xql-UmVOME_OyPYS1IQNXV3LWWKu10yYBEosAcfDNueoOEB_vyatWUtRoMDcFZ494&_hsmi=423871348&utm_content=423871348&utm_source=hs_email";
    const result = sanitizeEmailHtml(`<a href="${url}">read more</a>`);

    expect(result).toContain("https://tailscale.com/blog/ai-without-lock-in");
    expect(result).toContain("utm_campaign=aperture-onboarding");
    expect(result).toContain("&amp;utm_medium=email");
    expect(result).not.toContain("&amp;amp;");
  });

  it("strips javascript: href on links", () => {
    const result = sanitizeEmailHtml('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain("javascript:");
  });

  it("strips http:// src from images (only https allowed)", () => {
    const result = sanitizeEmailHtml('<img src="http://tracker.com/pixel.gif" alt="t">');
    expect(result).not.toContain('src="http://');
  });
});

describe("sanitizeEmailHtmlForIframe", () => {
  it("removes scripts, event handlers, javascript URLs, and remote image sources by default", () => {
    const result = sanitizeEmailHtmlForIframe(
      '<div onclick="steal()"><a href="javascript:alert(1)">bad</a><img src="https://example.com/a.png" onerror="xss()"><script>alert(1)</script></div>'
    );
    expect(result).not.toContain("<script");
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("onerror");
    expect(result).not.toContain("javascript:");
    expect(result).not.toContain('src="https://example.com/a.png"');
    expect(result).toContain("<img");
  });

  it("preserves image layout attributes and cid sources while blocking network images", () => {
    const result = sanitizeEmailHtmlForIframe(
      '<img src="https://tracker.example/open.gif" alt="Receipt" width="600" height="200"><img src="cid:logo@example" alt="Logo">'
    );

    expect(result).not.toContain("tracker.example");
    expect(result).toContain('alt="Receipt"');
    expect(result).toContain('width="600"');
    expect(result).toContain('height="200"');
    expect(result).toContain('src="cid:logo@example"');
  });

  it("allows only HTTPS remote images after explicit opt-in", () => {
    const result = sanitizeEmailHtmlForIframe(
      '<img src="https://cdn.example/newsletter.png"><img src="http://tracker.example/open.gif">',
      { allowRemoteImages: true }
    );

    expect(result).toContain('src="https://cdn.example/newsletter.png"');
    expect(result).not.toContain("http://tracker.example");
  });

  it("detects remote image sources without treating cid images as remote", () => {
    expect(hasRemoteEmailImages('<img src="https://cdn.example/a.png">')).toBe(true);
    expect(hasRemoteEmailImages('<img src="http://cdn.example/a.png">')).toBe(false);
    expect(hasRemoteEmailImages('<img src="cid:logo@example">')).toBe(false);
    expect(hasRemoteEmailImages('<p>https://cdn.example/a.png</p>')).toBe(false);
  });

  it("does not allow data image URLs in rendered email HTML", () => {
    const result = sanitizeEmailHtmlForIframe(
      '<img src="data:image/svg+xml,<svg onload=alert(1)>" alt="x">'
    );
    expect(result).not.toContain("data:image");
  });

  it("preserves HubSpot-style tracking hrefs for iframe rendering", () => {
    const trackingUrl =
      "https://info.tailscale.com/e3t/Ctc/OT+113/d4K34c04/VX8QL33KvRDRW6lM-WB6GpGF8W9fbdmV5Qmkd9N8GDX6T3qgz0W7Y8-PT6lZ3mBW2k9_gr3nCxcXW40hBfy4sz-8vW6lkkpC1xp3bYW2Pb0yc3tVbGrW139cm71dxZCgVdfvmx8rbR2QW82vFsQ3jgwSPW6t8m9y8x5f_VW8WKzcZ2M9L_3W7bql6N5PyB3qW46t3bk6-CY1wN4Kx2nRhLfqlW6p8RLp7kyGV8W3jMBbw590yLzMhLvRJ9vjr4N7H834gvyZQbW4WpQsj3cF8QTW37FZYr2fgJv6N1Dks5K35g0gW8b0-D68X9V5zW4RMR3X4X87QkW8vNMWC8LFDKDW3y5SWz8r3VS6W63G4nC8mw2-YVtbn5P40K3j2W5Wvqd53B78zGf5_nShY04";
    const result = sanitizeEmailHtmlForIframe(`<a href="${trackingUrl}">Open</a>`);

    expect(result).toContain('href="https://info.tailscale.com/e3t/Ctc/OT+113/');
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener noreferrer"');
  });
});

describe("linkifyText", () => {
  it("converts https URLs to anchor tags", () => {
    const result = linkifyText("Check this: https://example.com today");
    expect(result).toContain('<a href="https://example.com"');
  });

  it("opens links in new tab", () => {
    const result = linkifyText("https://example.com");
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener noreferrer"');
  });

  it("does not alter text without URLs", () => {
    const result = linkifyText("Just plain text here");
    expect(result).not.toContain("<a");
    expect(result).toContain("Just plain text here");
  });

  it("converts newlines to <br>", () => {
    const result = linkifyText("Line 1\nLine 2");
    expect(result).toContain("<br>");
    expect(result).not.toContain("\n");
  });

  it("escapes < and > characters", () => {
    const result = linkifyText("Hello <World>");
    expect(result).toContain("&lt;World&gt;");
    expect(result).not.toContain("<World>");
  });

  it("escapes & character", () => {
    const result = linkifyText("cats & dogs");
    expect(result).toContain("&amp;");
  });

  it("does not double-encode plain-text URLs with query params", () => {
    const result = linkifyText(
      "Read https://www.linkedin.com/jobs/view/123?trk=email_job_alert&refId=abc%2B123"
    );

    expect(result).toContain("trk=email_job_alert&amp;refId=abc%2B123");
    expect(result).not.toContain("&amp;amp;");
    expect(result).not.toContain("%252B");
  });

  it("escapes double quotes", () => {
    const result = linkifyText('Say "hello"');
    expect(result).toContain("&quot;");
  });
});

describe("renderEmailBodyHtml", () => {
  it("sanitizes HTML bodies (strips script)", () => {
    const result = renderEmailBodyHtml(
      "<p>Hello</p><script>bad()</script>"
    );
    expect(result).not.toContain("<script");
    expect(result).toContain("Hello");
  });

  it("linkifies plain text bodies", () => {
    const result = renderEmailBodyHtml(
      "I've shared an item: https://docs.google.com/document/d/abc"
    );
    expect(result).toContain('<a href="https://docs.google.com/document/d/abc"');
  });

  it("routes DOCTYPE body through HTML sanitizer not linkifier", () => {
    const result = renderEmailBodyHtml(
      '<!DOCTYPE html><html><body><p>Hi</p></body></html>'
    );
    expect(result).toContain("Hi");
    expect(result).not.toContain("DOCTYPE");
  });
});

describe("stripHtmlToText", () => {
  it("strips HTML tags from an HTML body", () => {
    const result = stripHtmlToText("<p>Hello <b>world</b></p>");
    expect(result).toBe("Hello world");
  });

  it("strips style and script blocks entirely", () => {
    const result = stripHtmlToText(
      "<style>.foo{color:red}</style><p>Content</p><script>alert(1)</script>"
    );
    expect(result).not.toContain(".foo");
    expect(result).not.toContain("alert");
    expect(result).toBe("Content");
  });

  it("generates readable text from sanitized content, not raw comments or CSS", () => {
    const result = stripHtmlToText(
      '<html><head><style>.preview{display:none}</style></head><body><!-- hidden --><p>Hello&nbsp;<strong>world</strong></p><script>bad()</script></body></html>'
    );
    expect(result).toBe("Hello world");
  });

  it("decodes common HTML entities", () => {
    const result = stripHtmlToText("<p>cats &amp; dogs &lt;3&gt;</p>");
    expect(result).toBe("cats & dogs <3>");
  });

  it("truncates at maxLength and appends ellipsis", () => {
    const result = stripHtmlToText("<p>" + "a".repeat(100) + "</p>", 20);
    expect(result.endsWith("…")).toBe(true);
    expect([...result].length).toBe(21); // 20 chars + ellipsis char
  });

  it("does not truncate short HTML bodies", () => {
    const result = stripHtmlToText("<p>Short</p>", 80);
    expect(result).toBe("Short");
  });

  it("strips markdown syntax from plain text", () => {
    const result = stripHtmlToText("**Bold** and _italic_ text");
    expect(result).toBe("Bold and italic text");
  });

  it("collapses newlines in plain text", () => {
    const result = stripHtmlToText("Line 1\nLine 2\nLine 3");
    expect(result).toBe("Line 1 Line 2 Line 3");
  });

  it("removes plain-text CSS rules and newsletter separator banners from snippets", () => {
    const result = stripHtmlToText(
      "a {text-decoration: none;}\nbody { margin:0; }\n***************\n5-Bullet Friday\n***************\nReadable intro",
      120
    );
    expect(result).toBe("5-Bullet Friday Readable intro");
  });

  it("returns empty string for blank input", () => {
    expect(stripHtmlToText("")).toBe("");
    expect(stripHtmlToText("   ")).toBe("");
  });
});
