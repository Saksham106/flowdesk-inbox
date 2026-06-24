import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("email remote-image privacy UI wiring", () => {
  it("builds blocked and explicit opt-in variants on the server", () => {
    const source = readFileSync(join(process.cwd(), "app/components/EmailBody.tsx"), "utf8");

    expect(source).toContain("hasRemoteEmailImages(body)");
    expect(source).toContain("sanitizeEmailHtmlForIframe(body)");
    expect(source).toContain("allowRemoteImages: true");
    expect(source).toContain("remoteHtml={remoteHtml}");
  });

  it("requires a per-message action and suppresses referrer data", () => {
    const source = readFileSync(
      join(process.cwd(), "app/components/EmailBodyIframe.tsx"),
      "utf8"
    );

    expect(source).toContain("Remote images blocked for privacy");
    expect(source).toContain("Load images");
    expect(source).toContain('referrerPolicy="no-referrer"');
    expect(source).toContain("allowRemoteImages: remoteImagesLoaded");
    expect(source).toContain("setRemoteImagesLoaded(false)");
  });
});
