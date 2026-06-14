import { describe, it, expect } from "vitest";
import {
  isHtmlBody,
  sanitizeEmailHtml,
  sanitizeEmailHtmlForIframe,
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
  it("removes scripts, event handlers, and javascript URLs before iframe rendering", () => {
    const result = sanitizeEmailHtmlForIframe(
      '<div onclick="steal()"><a href="javascript:alert(1)">bad</a><img src="https://example.com/a.png" onerror="xss()"><script>alert(1)</script></div>'
    );
    expect(result).not.toContain("<script");
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("onerror");
    expect(result).not.toContain("javascript:");
    expect(result).toContain('src="https://example.com/a.png"');
  });

  it("does not allow data image URLs in rendered email HTML", () => {
    const result = sanitizeEmailHtmlForIframe(
      '<img src="data:image/svg+xml,<svg onload=alert(1)>" alt="x">'
    );
    expect(result).not.toContain("data:image");
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
