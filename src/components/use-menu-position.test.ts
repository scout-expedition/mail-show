// @vitest-environment node
import { describe, expect, it } from "vitest";
import { computeMenuPosition } from "./use-menu-position";

const viewport = { width: 1280, height: 800 };
const MARGIN = 4;

// A representative trigger near the top-center of the viewport.
const triggerCenter = { top: 50, bottom: 70, left: 600, right: 640 };
// A trigger near the bottom of the viewport.
const triggerBottom = { top: 760, bottom: 780, left: 600, right: 640 };
// A trigger near the top of the viewport.
const triggerTop = { top: 10, bottom: 30, left: 600, right: 640 };
// A trigger near the right edge.
const triggerRight = { top: 300, bottom: 320, left: 1200, right: 1240 };
// A trigger near the left edge.
const triggerLeft = { top: 300, bottom: 320, left: 10, right: 50 };

const smallMenu = { width: 120, height: 80 };
const wideMenu = { width: 300, height: 80 };

describe("computeMenuPosition", () => {
  it("places menu below trigger when there is plenty of room (prefer down + right)", () => {
    const result = computeMenuPosition(
      triggerCenter,
      smallMenu,
      viewport,
      "right",
      "down",
      MARGIN
    );
    expect(result.placement).toBe("down");
    // top = trigger.bottom + margin
    expect(result.top).toBe(triggerCenter.bottom + MARGIN);
    // left = trigger.right - menuW, clamped — trigger.right(640) - 120 = 520, well within viewport
    expect(result.left).toBe(triggerCenter.right - smallMenu.width);
  });

  it("flips to up when there is not enough room below (prefer down)", () => {
    const result = computeMenuPosition(
      triggerBottom,
      smallMenu,
      viewport,
      "right",
      "down",
      MARGIN
    );
    // triggerBottom.bottom(780) + 80 + 4 = 864 > 800 → flip
    expect(result.placement).toBe("up");
    expect(result.top).toBe(triggerBottom.top - smallMenu.height - MARGIN);
  });

  it("uses up placement when preferred and there is room above", () => {
    const result = computeMenuPosition(
      triggerCenter,
      smallMenu,
      viewport,
      "right",
      "up",
      MARGIN
    );
    // triggerCenter.top(50) - 80 - 4 = -34 < 0, so no room → flip to down
    // (triggerCenter is only 50px from top; menu is 80px tall)
    expect(result.placement).toBe("down");
  });

  it("stays up when preferredPlacement is up and there is room above", () => {
    // Trigger at y=300; menu 80px tall → 300 - 80 - 4 = 216 >= 0 → stays up
    const deepTrigger = { top: 300, bottom: 320, left: 600, right: 640 };
    const result = computeMenuPosition(
      deepTrigger,
      smallMenu,
      viewport,
      "right",
      "up",
      MARGIN
    );
    expect(result.placement).toBe("up");
    expect(result.top).toBe(deepTrigger.top - smallMenu.height - MARGIN);
  });

  it("flips from up to down when no room above (prefer up)", () => {
    const result = computeMenuPosition(
      triggerTop,
      smallMenu,
      viewport,
      "right",
      "up",
      MARGIN
    );
    // triggerTop.top(10) - 80 - 4 = -74 < 0 → flip to down
    expect(result.placement).toBe("down");
    expect(result.top).toBe(triggerTop.bottom + MARGIN);
  });

  it("right-align clamps left when menu is wider than trigger column", () => {
    // trigger.right - menuW = 1240 - 300 = 940; 940 + 300 + 4 = 1244 > 1280 → clamp
    const result = computeMenuPosition(
      triggerRight,
      wideMenu,
      viewport,
      "right",
      "down",
      MARGIN
    );
    const unclamped = triggerRight.right - wideMenu.width;
    const maxLeft = viewport.width - wideMenu.width - MARGIN;
    expect(result.left).toBe(Math.max(MARGIN, Math.min(unclamped, maxLeft)));
  });

  it("left-align places menu starting at trigger left", () => {
    const result = computeMenuPosition(
      triggerCenter,
      smallMenu,
      viewport,
      "left",
      "down",
      MARGIN
    );
    // trigger.left = 600; 600 + 120 + 4 = 724 < 1280, no clamp needed
    expect(result.left).toBe(triggerCenter.left);
  });

  it("left-align clamps when menu overflows right edge", () => {
    // trigger.left = 1200, menuW = 300 → 1200 + 300 = 1500 > 1280 → clamp
    const result = computeMenuPosition(
      triggerRight,
      wideMenu,
      viewport,
      "left",
      "down",
      MARGIN
    );
    const maxLeft = viewport.width - wideMenu.width - MARGIN;
    expect(result.left).toBe(maxLeft);
  });

  it("respects margin on both left and right edges", () => {
    // Near-left trigger: trigger.right - menuW could go negative
    const result = computeMenuPosition(
      triggerLeft,
      wideMenu,
      viewport,
      "right",
      "down",
      MARGIN
    );
    // unclamped = 50 - 300 = -250, must be clamped to margin(4)
    expect(result.left).toBe(MARGIN);
  });

  it("respects a custom margin value", () => {
    const customMargin = 8;
    const result = computeMenuPosition(
      triggerCenter,
      smallMenu,
      viewport,
      "right",
      "down",
      customMargin
    );
    expect(result.top).toBe(triggerCenter.bottom + customMargin);
  });
});
