export type DesktopPanelLayout = {
  leftWidth: number;
  rightWidth: number;
};

export const DEFAULT_DESKTOP_PANEL_LAYOUT: DesktopPanelLayout = {
  leftWidth: 280,
  rightWidth: 300,
};

const LEFT_MIN = 220;
const LEFT_MAX = 420;
const RIGHT_MIN = 240;
const RIGHT_MAX = 420;
const MAIN_MIN = 480;

function isUsableWidth(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampDesktopPanelLayout({
  containerWidth,
  leftWidth,
  rightWidth,
}: {
  containerWidth: number;
  leftWidth: number;
  rightWidth: number;
}): DesktopPanelLayout {
  if (!isUsableWidth(leftWidth) || !isUsableWidth(rightWidth)) {
    return DEFAULT_DESKTOP_PANEL_LAYOUT;
  }

  let nextLeft = clamp(Math.round(leftWidth), LEFT_MIN, LEFT_MAX);
  let nextRight = clamp(Math.round(rightWidth), RIGHT_MIN, RIGHT_MAX);
  const maxSideWidth = Math.max(0, Math.floor(containerWidth - MAIN_MIN));

  if (nextLeft + nextRight > maxSideWidth) {
    const overflow = nextLeft + nextRight - maxSideWidth;
    const rightCanGive = Math.max(0, nextRight - RIGHT_MIN);
    const rightReduction = Math.min(overflow, rightCanGive);
    nextRight -= rightReduction;

    const remainingOverflow = overflow - rightReduction;
    if (remainingOverflow > 0) {
      const leftCanGive = Math.max(0, nextLeft - LEFT_MIN);
      nextLeft -= Math.min(remainingOverflow, leftCanGive);
    }
  }

  return {
    leftWidth: nextLeft,
    rightWidth: nextRight,
  };
}
