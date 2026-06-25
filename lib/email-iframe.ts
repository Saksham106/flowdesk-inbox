const DARK_MODE_MEDIA_RE = /@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{/gi;
const COLOR_SCHEME_META_RE =
  /<meta\b(?=[^>]*(?:name=["']?(?:color-scheme|supported-color-schemes)["']?|content=["']?[^"'>]*\blight\s+dark\b))[^>]*>/gi;
// Viewport meta tags can cause browsers to zoom srcdoc iframe content: e.g. <meta name="viewport"
// content="width=600"> in a 900px-wide iframe produces a 1.5× zoom. Strip them unconditionally.
const VIEWPORT_META_RE = /<meta\b(?=[^>]*\bname\s*=\s*["']?viewport["']?)[^>]*>/gi;

export const EMAIL_IFRAME_SANDBOX = "allow-popups allow-popups-to-escape-sandbox allow-same-origin";

export type EmailIframeOptions = {
  allowRemoteImages?: boolean;
};

function emailContentSecurityPolicy(allowRemoteImages: boolean): string {
  const images = allowRemoteImages ? "https: data: cid:" : "data: cid:";
  return [
    "default-src 'none'",
    `img-src ${images}`,
    "style-src 'unsafe-inline'",
    "font-src 'none'",
    "connect-src 'none'",
    "media-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

function removeBalancedCssBlocks(css: string, pattern: RegExp): string {
  let output = "";
  let cursor = 0;
  pattern.lastIndex = 0;

  for (let match = pattern.exec(css); match; match = pattern.exec(css)) {
    const start = match.index;
    let depth = 1;
    let index = pattern.lastIndex;

    while (index < css.length && depth > 0) {
      const char = css[index];
      if (char === "{") depth++;
      if (char === "}") depth--;
      index++;
    }

    output += css.slice(cursor, start);
    cursor = index;
    pattern.lastIndex = index;
  }

  return output + css.slice(cursor);
}

export function stripEmailDarkModeHints(html: string): string {
  return removeBalancedCssBlocks(html, DARK_MODE_MEDIA_RE).replace(COLOR_SCHEME_META_RE, "");
}

export function stripEmailViewportMeta(html: string): string {
  VIEWPORT_META_RE.lastIndex = 0;
  return html.replace(VIEWPORT_META_RE, "");
}

function lightModeContainmentCss(): string {
  return `
    :root { color-scheme: light only; supported-color-schemes: light; background: #ffffff; }
    /* overflow:hidden on html prevents the iframe doc from growing its own scrollbar;
       height is driven entirely by the parent's measured iframe height. */
    html { overflow: hidden; max-width: 100%; background: #ffffff; }
    body { max-width: 100%; overflow-x: hidden; background: #ffffff; box-sizing: border-box; color: #111827; font-size: 14px; line-height: 1.5; word-break: break-word; overflow-wrap: anywhere; }
    *, *::before, *::after { box-sizing: border-box; max-width: 100%; }
    /* Do NOT set width:auto — that overrides HTML width="" attributes and breaks
       newsletter centering (e.g. <table width="600" align="center">).
       Do NOT use !important on max-width — newsletter inner tables intentionally set
       max-width: 600px (or similar) to center a content column. !important would override
       those inline constraints, expanding the table to full iframe width and zooming the email. */
    table { max-width: 100%; border-collapse: collapse; table-layout: auto; }
    td, th { overflow-wrap: anywhere; word-break: break-word; }
    /* No !important on max-width: small icons use inline max-width (e.g. style="max-width:24px")
       as their sole size constraint — !important would override that, rendering retina PNGs at
       their natural 2× size. Without !important, inline/class constraints win (higher specificity)
       while our rule still caps images that have no sender-defined max-width.
       Keep !important on height:auto to prevent aspect-ratio distortion from fixed email heights. */
    img, video { max-width: 100%; height: auto !important; }
    pre, code { white-space: pre-wrap; overflow-wrap: anywhere; }
    a { color: #2563eb; overflow-wrap: anywhere; }
  `;
}

export function buildEmailIframeSrcDoc(
  html: string,
  options: EmailIframeOptions = {}
): string {
  const lightHtml = stripEmailViewportMeta(stripEmailDarkModeHints(html));
  const policy = emailContentSecurityPolicy(options.allowRemoteImages === true);
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}"><meta charset="utf-8"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">`;
  const injected = `${meta}<style>${lightModeContainmentCss()}</style>`;

  if (/<html\b/i.test(lightHtml)) {
    if (/<head\b[^>]*>/i.test(lightHtml)) {
      return lightHtml.replace(/(<head\b[^>]*>)/i, `$1${injected}`);
    }
    return lightHtml.replace(/(<html\b[^>]*>)/i, `$1<head>${injected}</head>`);
  }

  return `<!DOCTYPE html><html><head>${injected}<style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 0; }
  </style></head><body>${lightHtml}</body></html>`;
}
