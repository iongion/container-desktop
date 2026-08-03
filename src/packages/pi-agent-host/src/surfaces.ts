import { createLogger } from "@/logger";
import type { BridgeEvent, SurfaceOverlayPlacement, SurfaceSlot } from "@/pi-bridge/protocol";

const logger = createLogger("pi-agent-host.surfaces");

// Structurally pi's `Component` plus the `dispose` its factories may add. Declared loosely on purpose:
// third-party components are held to what the registry actually calls, not to pi's full interface.
export interface SurfaceComponent {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate?(): void;
  dispose?(): void;
}

export interface SurfaceOpenOptions {
  focus?: boolean;
  overlay?: boolean;
  placement?: SurfaceOverlayPlacement;
  // Called once when the surface closes, however it closes — a slot replacement and an explicit close
  // both settle a pending `ui.custom()` through here.
  onClose?: () => void;
}

export interface SurfaceRegistry {
  open(slot: SurfaceSlot, component: SurfaceComponent, options?: SurfaceOpenOptions): string;
  rerender(surfaceId: string): void;
  input(surfaceId: string, data: string): void;
  resize(surfaceId: string, columns: number): void;
  close(surfaceId: string): void;
  closeSlot(slot: SurfaceSlot): void;
  closeAll(): void;
  // A component asked its TUI to repaint, so every open surface is re-rendered: pi's TUI owns one screen
  // and has no way to say which of our slots the request came from.
  rerenderAll(): void;
  resizeAll(columns: number): void;
  // Drops each component's cached styling, then re-renders — what a theme change needs.
  invalidateAll(): void;
  focusedSurfaceId(): string | undefined;
  surfaceIdForSlot(slot: SurfaceSlot): string | undefined;
}

interface SurfaceState {
  id: string;
  slotKey: string;
  slot: SurfaceSlot;
  component: SurfaceComponent;
  columns: number;
  focus: boolean;
  overlay: boolean;
  placement?: SurfaceOverlayPlacement;
  onClose?: () => void;
  lastFrame?: string;
}

export function createSurfaceRegistry(options: {
  emit: (event: BridgeEvent) => void;
  defaultColumns: number;
}): SurfaceRegistry {
  const surfaces = new Map<string, SurfaceState>();
  const bySlot = new Map<string, string>();
  // A stack, not a single id: closing a dialog opened over another must hand focus back rather than
  // dropping the session into a state where nothing takes keys.
  const focusStack: string[] = [];
  let nextId = 0;

  const emitFrame = (surface: SurfaceState) => {
    const lines = renderLines(surface);
    const signature = JSON.stringify([lines, surface.focus, surface.overlay, surface.placement]);
    if (signature === surface.lastFrame) return;
    surface.lastFrame = signature;
    options.emit({
      type: "surface_frame",
      surfaceId: surface.id,
      slot: surface.slot,
      lines,
      focus: surface.focus,
      overlay: surface.overlay,
      ...(surface.placement ? { placement: surface.placement } : {}),
    });
  };

  const destroy = (surface: SurfaceState) => {
    surfaces.delete(surface.id);
    if (bySlot.get(surface.slotKey) === surface.id) bySlot.delete(surface.slotKey);
    const focusIndex = focusStack.lastIndexOf(surface.id);
    if (focusIndex >= 0) focusStack.splice(focusIndex, 1);
    try {
      surface.component.dispose?.();
    } catch (error) {
      logger.error("surface dispose threw", error);
    }
    options.emit({ type: "surface_closed", surfaceId: surface.id });
    try {
      surface.onClose?.();
    } catch (error) {
      logger.error("surface close handler threw", error);
    }
  };

  return {
    open(slot, component, openOptions) {
      const slotKey = keyForSlot(slot);
      const occupant = bySlot.get(slotKey);
      if (occupant) {
        const previous = surfaces.get(occupant);
        if (previous) destroy(previous);
      }

      nextId += 1;
      const surface: SurfaceState = {
        id: `surface-${nextId}`,
        slotKey,
        slot,
        component,
        columns: options.defaultColumns,
        focus: openOptions?.focus === true,
        overlay: openOptions?.overlay === true,
        placement: openOptions?.placement,
        onClose: openOptions?.onClose,
      };
      surfaces.set(surface.id, surface);
      bySlot.set(slotKey, surface.id);
      if (surface.focus) focusStack.push(surface.id);
      emitFrame(surface);
      return surface.id;
    },

    rerender(surfaceId) {
      const surface = surfaces.get(surfaceId);
      if (surface) emitFrame(surface);
    },

    input(surfaceId, data) {
      const surface = surfaces.get(surfaceId);
      if (!surface) return;
      try {
        surface.component.handleInput?.(data);
      } catch (error) {
        // A plugin that throws on a keystroke must not take the session with it.
        logger.error("surface input threw", error);
      }
      emitFrame(surface);
    },

    resize(surfaceId, columns) {
      const surface = surfaces.get(surfaceId);
      if (!surface) return;
      const width = Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : surface.columns;
      if (width === surface.columns) return;
      surface.columns = width;
      surface.component.invalidate?.();
      emitFrame(surface);
    },

    close(surfaceId) {
      const surface = surfaces.get(surfaceId);
      if (surface) destroy(surface);
    },

    closeSlot(slot) {
      const surfaceId = bySlot.get(keyForSlot(slot));
      const surface = surfaceId ? surfaces.get(surfaceId) : undefined;
      if (surface) destroy(surface);
    },

    closeAll() {
      for (const surface of [...surfaces.values()]) destroy(surface);
    },

    rerenderAll() {
      for (const surface of [...surfaces.values()]) emitFrame(surface);
    },

    resizeAll(columns) {
      const width = Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : undefined;
      if (width === undefined) return;
      for (const surface of [...surfaces.values()]) {
        if (surface.columns === width) continue;
        surface.columns = width;
        surface.component.invalidate?.();
        emitFrame(surface);
      }
    },

    invalidateAll() {
      for (const surface of [...surfaces.values()]) {
        try {
          surface.component.invalidate?.();
        } catch (error) {
          logger.error("surface invalidate threw", error);
        }
        emitFrame(surface);
      }
    },

    focusedSurfaceId() {
      return focusStack.at(-1);
    },

    surfaceIdForSlot(slot) {
      return bySlot.get(keyForSlot(slot));
    },
  };
}

function renderLines(surface: SurfaceState): string[] {
  try {
    return surface.component.render(surface.columns) ?? [];
  } catch (error) {
    logger.error("surface render threw", error);
    return [`component render failed: ${(error as Error).message}`];
  }
}

function keyForSlot(slot: SurfaceSlot): string {
  switch (slot.kind) {
    case "tool":
      return `tool:${slot.toolCallId}:${slot.slot}`;
    case "custom":
      return `custom:${slot.surfaceId}`;
    case "widget":
      return `widget:${slot.widgetKey}`;
    default:
      return slot.kind;
  }
}
