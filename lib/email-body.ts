import sanitizeHtml from "sanitize-html";

export function isHtmlBody(body: string): boolean {
  // Strip BOM and whitespace, then check for HTML
  return /^\s*</.test(body.replace(/^﻿/, ""));
}

// Strict sanitizer for rendering HTML inline in the app (strips all CSS to prevent bleed)
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "b", "i", "u", "strong", "em",
      "a", "ul", "ol", "li",
      "table", "thead", "tbody", "tr", "td", "th",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "div", "span", "img", "pre", "code", "blockquote", "hr",
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "width", "height"],
    },
    allowedSchemesByTag: {
      a: ["http", "https", "mailto"],
      img: ["https"],
    },
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: {
          ...(attribs.href ? { href: attribs.href } : {}),
          ...(attribs.title ? { title: attribs.title } : {}),
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
    },
  });
}

// Permissive sanitizer for rendering inside a sandboxed iframe
// Keeps CSS (style tags + inline styles) for visual fidelity; removes only dangerous elements
export function sanitizeEmailHtmlForIframe(html: string): string {
  const cleaned = sanitizeHtml(html, {
    allowedTags: [
      // Structure
      "html", "head", "body", "title", "meta",
      // Formatting
      "p", "br", "b", "i", "u", "strong", "em", "s", "sub", "sup",
      "a", "ul", "ol", "li", "dl", "dt", "dd",
      // Tables (email layouts rely heavily on tables)
      "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col",
      // Headings & semantic
      "h1", "h2", "h3", "h4", "h5", "h6",
      "div", "span", "section", "article", "header", "footer", "main", "aside",
      "blockquote", "pre", "code", "hr",
      // Media
      "img", "picture", "source", "figure", "figcaption",
      // Email-specific legacy tags
      "center", "font",
      // Styles (preserved so email CSS works)
      "style",
    ],
    allowedAttributes: {
      "*": ["style", "class", "id", "align", "valign", "bgcolor", "border",
            "cellpadding", "cellspacing", "color", "height", "width", "role",
            "aria-label", "aria-hidden", "dir", "lang"],
      a: ["href", "title", "target", "rel", "name"],
      img: ["src", "alt", "width", "height", "border", "loading"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan", "scope"],
      meta: ["charset", "name", "content"],
      table: ["summary"],
      col: ["span"],
      colgroup: ["span"],
    },
    allowedSchemesByTag: {
      a: ["http", "https", "mailto"],
      img: ["http", "https", "cid"],
    },
    // Completely remove dangerous tags and their content
    nonTextTags: ["script", "iframe", "frame", "object", "embed", "applet", "base"],
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: {
          ...attribs,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
    },
    disallowedTagsMode: "discard",
    allowVulnerableTags: true,
  });
  return cleaned;
}

const URL_RE = /https?:\/\/[^\s<>"]+/g;
const BOLD_RE = /\*\*([^*\n]+)\*\*/g;
const ITALIC_RE = /(?<![a-zA-Z0-9])_([^_\n]+)_(?![a-zA-Z0-9])/g;

function applyBasicMarkdown(text: string): string {
  return text
    .replace(BOLD_RE, "<strong>$1</strong>")
    .replace(ITALIC_RE, "<em>$1</em>");
}

export function linkifyText(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return applyBasicMarkdown(escaped)
    .replace(/\n/g, "<br>")
    .replace(
      URL_RE,
      (url) =>
        `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
    );
}

export function renderEmailBodyHtml(body: string): string {
  if (isHtmlBody(body)) {
    return sanitizeEmailHtml(body);
  }
  return linkifyText(body);
}

export function stripHtmlToText(body: string, maxLength = 80): string {
  let text: string;
  if (isHtmlBody(body)) {
    text = sanitizeHtml(body, {
      allowedTags: [],
      allowedAttributes: {},
      nonTextTags: [
        "head",
        "style",
        "script",
        "template",
        "iframe",
        "frame",
        "object",
        "embed",
        "applet",
        "base",
        "noscript",
      ],
      disallowedTagsMode: "discard",
    })
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  } else {
    text = body
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      .replace(/\n/g, " ")
      .trim();
  }
  return text.length > maxLength ? text.slice(0, maxLength) + "…" : text;
}
