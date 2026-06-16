// Tray-window positioning. Ported from electron-traywindow-positioner
// (https://github.com/pixtron/electron-traywindow-positioner) — small enough to own rather than
// depend on. Rewritten in TypeScript with type-safety and three multi-monitor bug fixes vs the
// original JS:
//   1. taskbar 'right' case now adds workArea.x (was `workArea.width - win.width`, wrong on a
//      secondary monitor whose workArea.x !== 0);
//   2. taskbar 'bottom' case now adds workArea.y (same bug on the y axis);
//   3. the vertical overlap clamp now uses the display's bounds.y origin (the original compared
//      against 0 / bounds.height, which breaks on vertically-stacked monitors).
// Final coordinates are rounded — BrowserWindow.setPosition requires integers.

import { type BrowserWindow, type Display, type Point, type Rectangle, screen } from "electron";

export type AlignX = "left" | "center" | "right";
export type AlignY = "up" | "center" | "down";
export interface Alignment {
  x?: AlignX;
  y?: AlignY;
}
export type TaskbarPosition = "top" | "right" | "bottom" | "left";

function getDisplay(bounds: Pick<Rectangle, "x" | "y">): Display {
  return screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
}

export function getTaskbarPosition(trayBounds: Rectangle): TaskbarPosition {
  const display = getDisplay(trayBounds);
  if (display.workArea.y > display.bounds.y) {
    return "top";
  }
  if (display.workArea.x > display.bounds.x) {
    return "left";
  }
  if (display.workArea.width === display.bounds.width) {
    return "bottom";
  }
  return "right";
}

function calculateXAlign(windowBounds: Rectangle, trayBounds: Rectangle, align: AlignX = "center"): number {
  const display = getDisplay(trayBounds);
  const alignLeft = () => trayBounds.x + trayBounds.width - windowBounds.width;
  const alignRight = () => trayBounds.x;
  let x: number;
  switch (align) {
    case "right":
      x = alignRight();
      break;
    case "left":
      x = alignLeft();
      break;
    default:
      x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2);
  }
  const displayRight = display.bounds.x + display.bounds.width;
  if (x + windowBounds.width > displayRight && align !== "left") {
    // would overflow the right edge -> align to the left of the tray icon instead
    x = alignLeft();
  } else if (x < display.bounds.x && align !== "right") {
    // would overflow the left edge -> align to the right of the tray icon instead
    x = alignRight();
  }
  return x;
}

function calculateYAlign(windowBounds: Rectangle, trayBounds: Rectangle, align: AlignY = "down"): number {
  const display = getDisplay(trayBounds);
  const alignUp = () => trayBounds.y + trayBounds.height - windowBounds.height;
  const alignDown = () => trayBounds.y;
  let y: number;
  switch (align) {
    case "up":
      y = alignUp();
      break;
    case "center":
      y = Math.round(trayBounds.y + trayBounds.height / 2 - windowBounds.height / 2);
      break;
    default:
      y = alignDown();
  }
  const displayTop = display.bounds.y;
  const displayBottom = display.bounds.y + display.bounds.height;
  if (y + windowBounds.height > displayBottom && align !== "up") {
    y = alignUp();
  } else if (y < displayTop && align !== "down") {
    y = alignDown();
  }
  return y;
}

function calculateFromBounds(windowBounds: Rectangle, tb: Rectangle, alignment: Alignment = {}): Point {
  const taskbarPosition = getTaskbarPosition(tb);
  const display = getDisplay(tb);
  let x: number;
  let y: number;

  switch (taskbarPosition) {
    case "left":
      x = display.workArea.x;
      y = calculateYAlign(windowBounds, tb, alignment.y);
      break;
    case "right":
      x = display.workArea.x + display.workArea.width - windowBounds.width;
      y = calculateYAlign(windowBounds, tb, alignment.y);
      break;
    case "bottom":
      x = calculateXAlign(windowBounds, tb, alignment.x);
      y = display.workArea.y + display.workArea.height - windowBounds.height;
      break;
    default:
      x = calculateXAlign(windowBounds, tb, alignment.x);
      y = display.workArea.y;
  }

  return { x: Math.round(x), y: Math.round(y) };
}

/** Compute where a tray window of `windowBounds` should sit given the tray icon `trayBounds`. */
export function calculate(windowBounds: Rectangle, trayBounds: Rectangle, alignment: Alignment = {}): Point {
  // On Linux the tray bounds are unreliable (0×0 under AppIndicator/StatusNotifierItem), so anchor
  // to the cursor instead (mirrors upstream behaviour and matches how the user clicked the icon).
  const tb: Rectangle =
    process.platform === "linux" ? { width: 0, height: 0, ...screen.getCursorScreenPoint() } : trayBounds;

  return calculateFromBounds(windowBounds, tb, alignment);
}

/** Compute a position from trusted bounds supplied by a native shell bridge. */
export function calculateAnchored(windowBounds: Rectangle, anchorBounds: Rectangle, alignment: Alignment = {}): Point {
  return calculateFromBounds(windowBounds, anchorBounds, alignment);
}

/** Position `window` next to the tray icon. */
export function position(window: BrowserWindow, trayBounds: Rectangle, alignment?: Alignment): void {
  const point = calculate(window.getBounds(), trayBounds, alignment);
  window.setPosition(point.x, point.y, false);
}

/** Position `window` next to trusted bounds supplied by a native shell bridge. */
export function positionAnchored(window: BrowserWindow, anchorBounds: Rectangle, alignment?: Alignment): void {
  const point = calculateAnchored(window.getBounds(), anchorBounds, alignment);
  window.setPosition(point.x, point.y, false);
}

export const trayPositioner = { getTaskbarPosition, calculate, calculateAnchored, position, positionAnchored };
