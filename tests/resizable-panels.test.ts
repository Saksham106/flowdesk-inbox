import { describe, expect, it } from "vitest";

import {
  clampDesktopPanelLayout,
  DEFAULT_DESKTOP_PANEL_LAYOUT,
} from "@/lib/resizable-panels";

describe("clampDesktopPanelLayout", () => {
  it("keeps left and right panels within sensible bounds", () => {
    const layout = clampDesktopPanelLayout({
      containerWidth: 1400,
      leftWidth: 120,
      rightWidth: 900,
    });

    expect(layout.leftWidth).toBe(220);
    expect(layout.rightWidth).toBe(420);
  });

  it("preserves a readable main thread width when side panels are large", () => {
    const layout = clampDesktopPanelLayout({
      containerWidth: 1100,
      leftWidth: 420,
      rightWidth: 420,
    });

    expect(layout.leftWidth + layout.rightWidth).toBeLessThanOrEqual(1100 - 480);
  });

  it("uses defaults when stored values are invalid", () => {
    const layout = clampDesktopPanelLayout({
      containerWidth: 1400,
      leftWidth: Number.NaN,
      rightWidth: -10,
    });

    expect(layout).toEqual(DEFAULT_DESKTOP_PANEL_LAYOUT);
  });
});
