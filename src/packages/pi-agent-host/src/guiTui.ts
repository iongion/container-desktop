import { type Terminal, TUI } from "@earendil-works/pi-tui";

// pi components ask their TUI to repaint when their state changes — a select list moving its cursor, a
// loader ticking. There is no screen here: the GUI paints line frames, so the request is routed to the
// surface registry instead of pi's differential renderer, which would otherwise emit escape codes into
// a buffer nobody reads and move a cursor that does not exist.
//
// The instance exists at all because plugin factories are handed one and call `addChild`, `setFocus`
// and `showOverlay` on it; those stay inherited and are harmless while the TUI is never started.
export class GuiTui extends TUI {
  private readonly onRequestRender: (() => void) | undefined;

  constructor(terminal: Terminal, onRequestRender: () => void) {
    super(terminal, false);
    this.onRequestRender = onRequestRender;
  }

  override requestRender(): void {
    this.onRequestRender?.();
  }
}
