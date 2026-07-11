import { describe, expect, it } from "vitest";

import { resolveOnboardingStep } from "@/lib/onboarding";

describe("resolveOnboardingStep", () => {
  it("starts at connect when nothing is set up", () => {
    expect(
      resolveOnboardingStep({ gmailConnected: false, styleTrained: false, justConnected: false })
    ).toBe("connect");
  });

  it("runs the first pass right after an OAuth connect", () => {
    expect(
      resolveOnboardingStep({ gmailConnected: true, styleTrained: false, justConnected: true })
    ).toBe("firstPass");
  });

  it("runs the first pass after a reconnect even if style is already trained", () => {
    expect(
      resolveOnboardingStep({ gmailConnected: true, styleTrained: true, justConnected: true })
    ).toBe("firstPass");
  });

  it("resumes at train when Gmail is connected but style is untrained", () => {
    expect(
      resolveOnboardingStep({ gmailConnected: true, styleTrained: false, justConnected: false })
    ).toBe("train");
  });

  it("is done when everything is set up", () => {
    expect(
      resolveOnboardingStep({ gmailConnected: true, styleTrained: true, justConnected: false })
    ).toBe("done");
  });
});
