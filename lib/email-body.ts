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

export type EmailIframeSanitizeOptions = {
  allowRemoteImages?: boolean;
};

const SAFE_RASTER_DATA_IMAGE_RE =
  /^data:image\/(?:png|jpe?g|gif|webp|bmp|tiff|ico);base64,[a-z0-9+/=]+$/i;

export function hasRemoteEmailImages(html: string): boolean {
  const imageOnly = sanitizeHtml(html, {
    allowedTags: ["img"],
    allowedAttributes: { img: ["src"] },
    allowedSchemesByTag: { img: ["https"] },
  });
  return /<img\b[^>]*\bsrc=["']https:\/\//i.test(imageOnly);
}

// Permissive sanitizer for rendering inside a sandboxed iframe.
// Keeps CSS (style tags + inline styles) for visual fidelity, but remote images
// remain blocked until the user explicitly opts in for the displayed message.
export function sanitizeEmailHtmlForIframe(
  html: string,
  options: EmailIframeSanitizeOptions = {}
): string {
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
      // "data" is included so resolved cid: inline images (stored as data URIs) survive
      // sanitization. Non-raster data URIs are blocked in the img transform below.
      img: ["http", "https", "cid", "data"],
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
      img: (_tagName, attribs) => {
        const nextAttribs = { ...attribs };
        const src = nextAttribs.src?.trim();
        const isRemote = /^https?:\/\//i.test(src ?? "");
        const isAllowedRemote = options.allowRemoteImages && /^https:\/\//i.test(src ?? "");
        const isData = /^data:/i.test(src ?? "");
        const isAllowedDataImage = SAFE_RASTER_DATA_IMAGE_RE.test(src ?? "");

        if ((isData && !isAllowedDataImage) || (isRemote && !isAllowedRemote)) {
          delete nextAttribs.src;
        } else if (src) {
          nextAttribs.src = src;
        }

        return { tagName: "img", attribs: nextAttribs };
      },
    },
    disallowedTagsMode: "discard",
    allowVulnerableTags: true,
  });
  return cleaned;
}

// Builds a Gmail-like preview line: "Subject — snippet" or just the snippet when
// no subject is available. Deduplicates when the snippet text is already contained
// in the subject (e.g. subject IS the first sentence of the body).
export function buildPreviewText(
  subject: string | null | undefined,
  bodySnippet: string,
  maxLength = 90
): string {
  const s = subject?.trim() ?? "";
  const b = bodySnippet.trim();

  if (!s && !b) return "";
  if (!s) return b.length > maxLength ? b.slice(0, maxLength) + "…" : b;
  // Skip snippet if it's redundant with the subject (snippet starts with the same text
  // or the subject contains the snippet's first meaningful words).
  const sLow = s.toLowerCase();
  const bLow = b.toLowerCase();
  const redundant = bLow.startsWith(sLow.slice(0, 20)) || sLow.startsWith(bLow.slice(0, 20));
  if (!b || redundant) {
    return s.length > maxLength ? s.slice(0, maxLength) + "…" : s;
  }

  const combined = `${s} — ${b}`;
  return combined.length > maxLength ? combined.slice(0, maxLength) + "…" : combined;
}

const URL_RE = /https?:\/\/[^\s<>"]+/g;
const BOLD_RE = /\*\*([^*\n]+)\*\*/g;
const ITALIC_RE = /(?<![a-zA-Z0-9])_([^_\n]+)_(?![a-zA-Z0-9])/g;
const PLAIN_TEXT_CSS_RULE_RE = /(^|\n)\s*[^{}\n]{1,100}\{[^{}\n]{0,800}\}\s*(?=\n|$)/g;
const SEPARATOR_BANNER_RE = /^\s*[*=_-]{3,}\s*$/gm;

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
      .replace(SEPARATOR_BANNER_RE, " ")
      .replace(/\s+/g, " ")
      .trim();
  } else {
    text = body
      .replace(PLAIN_TEXT_CSS_RULE_RE, "\n")
      .replace(SEPARATOR_BANNER_RE, " ")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return text.length > maxLength ? text.slice(0, maxLength) + "…" : text;
}
