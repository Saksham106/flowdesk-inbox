"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  html: string;
}

// Wrap the email HTML so it renders at a readable text size inside the iframe,
// and so the iframe background matches the card it sits in.
function wrapEmailHtml(html: string): string {
  const containment = `
    html, body { max-width: 100%; overflow-x: hidden; }
    body { box-sizing: border-box; font-size: 14px; line-height: 1.5; word-break: break-word; overflow-wrap: anywhere; }
    *, *::before, *::after { box-sizing: border-box; max-width: 100%; }
    table { max-width: 100% !important; width: auto; border-collapse: collapse; table-layout: auto; }
    td, th { overflow-wrap: anywhere; word-break: break-word; }
    img, video { max-width: 100% !important; height: auto !important; }
    pre, code { white-space: pre-wrap; overflow-wrap: anywhere; }
    a { color: #2563eb; overflow-wrap: anywhere; }
  `;
  // If the body already has <html> / <head>, inject a base-size style into <head>
  if (/<html\b/i.test(html)) {
    const injected = `<style>${containment}</style>`;
    return html.replace(/(<head\b[^>]*>)/i, `$1${injected}`);
  }
  // Bare HTML fragment — wrap it
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           margin: 0; padding: 0; }
    ${containment}
  </style></head><body>${html}</body></html>`;
}

export default function EmailBodyIframe({ html }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(300);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    function measure() {
      try {
        const doc = iframe?.contentDocument ?? iframe?.contentWindow?.document;
        if (doc?.body) {
          const h = doc.documentElement.scrollHeight || doc.body.scrollHeight;
          setHeight(Math.max(80, h + 4));
        }
      } catch {
        // cross-origin guard (shouldn't happen with srcdoc)
      }
    }

    iframe.addEventListener("load", measure);
    // Also observe resize (images loading late, etc.)
    let ro: ResizeObserver | null = null;
    iframe.addEventListener("load", () => {
      try {
        const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
        if (doc?.body) {
          ro = new ResizeObserver(measure);
          ro.observe(doc.body);
        }
      } catch { /* ignore */ }
    });

    return () => {
      iframe.removeEventListener("load", measure);
      ro?.disconnect();
    };
  }, [html]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={wrapEmailHtml(html)}
      sandbox="allow-popups allow-same-origin"
      style={{ width: "100%", maxWidth: "100%", minWidth: 0, height: `${height}px`, border: "none", display: "block", overflow: "hidden" }}
      title="Email content"
      loading="lazy"
    />
  );
}
