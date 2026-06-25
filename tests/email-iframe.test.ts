import { describe, expect, it } from "vitest";

import { sanitizeEmailHtmlForIframe } from "@/lib/email-body";
import { buildEmailIframeSrcDoc, EMAIL_IFRAME_SANDBOX, stripEmailViewportMeta } from "@/lib/email-iframe";

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

  // Regression: newsletter inner tables use max-width:600px to center a content column.
  // Our injected table/img rules must NOT use !important on max-width or they override those
  // constraints: tables expand to full iframe width (zoom), and retina icons render at 2× size.
  it("does not use !important on table or img max-width so sender constraints are preserved", () => {
    const srcDoc = buildEmailIframeSrcDoc(`
      <table style="width:100%;background:#f4f4f4">
        <tr><td align="center">
          <table style="max-width:600px;width:100%"><tr><td>
            <img src="icon@2x.png" style="max-width:24px;display:block" alt="icon">
          </td></tr></table>
        </td></tr>
      </table>
    `);

    expect(srcDoc).not.toMatch(/table\s*\{[^}]*max-width\s*:\s*100%\s*!important/);
    expect(srcDoc).not.toMatch(/img\s*,\s*video\s*\{[^}]*max-width\s*:\s*100%\s*!important/);
  });

  it("strips viewport meta tags to prevent browser-level zoom in srcdoc iframes", () => {
    const withViewport = `<html><head>
      <meta name="viewport" content="width=600, initial-scale=1">
      <meta charset="utf-8">
    </head><body>Newsletter</body></html>`;

    const srcDoc = buildEmailIframeSrcDoc(withViewport);

    expect(srcDoc).not.toMatch(/name=["']?viewport["']?/i);
    expect(srcDoc).toContain("Newsletter");
    expect(srcDoc).toContain('charset="utf-8"');
  });

  it("strips viewport meta when name and content attributes appear in reversed order", () => {
    const html = `<meta content="width=device-width, initial-scale=1" name="viewport">`;
    expect(stripEmailViewportMeta(html)).not.toMatch(/name=["']?viewport["']?/i);
  });
});

  // Regression: LinkedIn-style emails use retina PNGs constrained only by inline
  // max-width (no HTML width attribute, no CSS width property). !important on our
  // max-width rule would override that and render the 2× PNG at its natural size.
  it("preserves inline max-width constraints on small icons (no !important override)", () => {
    // Icon: natural size 48×48, displayed at 24px via max-width only
    const srcDoc = buildEmailIframeSrcDoc(
      `<img src="settings@2x.png" alt="Settings" style="max-width:24px;max-height:24px;display:block;">`
    );

    // The injected CSS must not carry !important on img max-width
    expect(srcDoc).not.toMatch(/img\s*,\s*video\s*\{[^}]*max-width\s*:\s*100%\s*!important/);
    // height:auto !important is still expected (prevents distortion from fixed email heights)
    expect(srcDoc).toMatch(/img\s*,\s*video\s*\{[^}]*height\s*:\s*auto\s*!important/);
    // The img tag itself must survive
    expect(srcDoc).toContain('alt="Settings"');
  });

describe("newsletter rendering layout", () => {
  it("preserves inner table max-width centering for a typical newsletter structure", () => {
    // Simulate a Roamic/travel-newsletter style HTML: outer 100%-width bg wrapper +
    // inner 600px-max content column.  The inner table's inline max-width must survive.
    const newsletter = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { margin: 0; padding: 0; }
    .wrapper { background: #f4f4f4; }
    .content { max-width: 600px; margin: 0 auto; }
  </style>
</head>
<body>
  <table class="wrapper" width="100%">
    <tr><td>
      <table class="content" style="max-width:600px;width:100%">
        <tr><td><h1>The Hotspot</h1></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const srcDoc = buildEmailIframeSrcDoc(newsletter);

    // Viewport meta stripped
    expect(srcDoc).not.toMatch(/name=["']?viewport["']?/i);
    // Content preserved
    expect(srcDoc).toContain("The Hotspot");
    // Newsletter's own .content class max-width must survive (no !important override on table)
    expect(srcDoc).toContain("max-width: 600px");
    // Our injected table rule must not be !important
    expect(srcDoc).not.toMatch(/table\s*\{[^}]*max-width\s*:\s*100%\s*!important/);
  });
});
