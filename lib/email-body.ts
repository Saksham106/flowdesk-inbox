import sanitizeHtml from "sanitize-html";

export function isHtmlBody(body: string): boolean {
  return body.trimStart().startsWith("<");
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
  });
}

const URL_RE = /https?:\/\/[^\s<>"]+/g;

export function linkifyText(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return escaped
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
