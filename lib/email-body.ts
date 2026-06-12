import sanitizeHtml from "sanitize-html";

export function isHtmlBody(body: string): boolean {
  return /^\s*</.test(body);
}

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
