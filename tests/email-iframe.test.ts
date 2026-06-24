import { describe, expect, it } from "vitest";

import { sanitizeEmailHtmlForIframe } from "@/lib/email-body";
import { buildEmailIframeSrcDoc, EMAIL_IFRAME_SANDBOX } from "@/lib/email-iframe";

describe("buildEmailIframeSrcDoc", () => {
  it("denies remote network loads by default", () => {
    const srcDoc = buildEmailIframeSrcDoc("<p>Private email</p>");

    expect(srcDoc).toContain("default-src 'none'");
    expect(srcDoc).toContain("img-src data: cid:");
    expect(srcDoc).not.toContain("img-src https:");
    expect(srcDoc).toContain("connect-src 'none'");
    expect(srcDoc).toContain("font-src 'none'");
    expect(srcDoc).toContain("frame-src 'none'");
    expect(srcDoc).toContain("form-action 'none'");
    expect(srcDoc).toContain("base-uri 'none'");
  });

  it("allows only HTTPS images after explicit opt-in", () => {
    const srcDoc = buildEmailIframeSrcDoc("<p>Newsletter</p>", {
      allowRemoteImages: true,
    });

    expect(srcDoc).toContain("img-src https: data: cid:");
    expect(srcDoc).not.toContain("img-src http:");
    expect(srcDoc).toContain("connect-src 'none'");
    expect(srcDoc).toContain("font-src 'none'");
    expect(srcDoc).toContain("frame-src 'none'");
    expect(srcDoc).toContain("form-action 'none'");
    expect(srcDoc).toContain("base-uri 'none'");
  });

  it("forces a light iframe color scheme and removes dark-mode-only email CSS", () => {
    const sanitized = sanitizeEmailHtmlForIframe(`
      <html>
        <head>
          <meta name="color-scheme" content="light dark">
          <meta name="supported-color-schemes" content="light dark">
          <style>
            body { background: #ffffff; color: #111111; }
            @media (prefers-color-scheme: dark) {
              body { background: #000000 !important; color: #ffffff !important; }
              .shipment { background: #111111 !important; }
            }
          </style>
        </head>
        <body><table class="shipment"><tr><td>Amazon shipment</td></tr></table></body>
      </html>
    `);

    const srcDoc = buildEmailIframeSrcDoc(sanitized);

    expect(srcDoc).toContain("color-scheme: light only");
    expect(srcDoc).toContain("background: #ffffff");
    expect(srcDoc).not.toContain("prefers-color-scheme");
    expect(srcDoc).not.toContain("background: #000000");
    expect(srcDoc).toContain("Amazon shipment");
  });

  it("preserves ordinary colored email sections while removing dark media rules", () => {
    const sanitized = sanitizeEmailHtmlForIframe(`
      <style>
        .brand { background: #ffcc00; color: #111111; }
        @media (prefers-color-scheme: dark) {
          .brand { background: #111111 !important; color: #ffffff !important; }
        }
      </style>
      <div class="brand">Newsletter block</div>
    `);

    const srcDoc = buildEmailIframeSrcDoc(sanitized);

    expect(srcDoc).toContain(".brand { background: #ffcc00; color: #111111; }");
    expect(srcDoc).not.toContain("prefers-color-scheme");
    expect(srcDoc).toContain("Newsletter block");
  });

  it("uses a sandbox that allows email links to open outside the iframe sandbox", () => {
    expect(EMAIL_IFRAME_SANDBOX.split(" ").sort()).toEqual(
      ["allow-popups", "allow-popups-to-escape-sandbox", "allow-same-origin"].sort()
    );
    expect(EMAIL_IFRAME_SANDBOX).not.toContain("allow-scripts");
    expect(EMAIL_IFRAME_SANDBOX).not.toContain("allow-top-navigation");
  });
});
