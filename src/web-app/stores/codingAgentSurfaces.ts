import type { BridgeEvent, SurfaceOverlayPlacement, SurfaceSlot } from "@/pi-bridge/protocol";

// One pi component, as the renderer holds it: the ANSI lines of its last frame plus where it belongs.
export interface CodingAgentSurface {
  surfaceId: string;
  slot: SurfaceSlot;
  lines: string[];
  focus: boolean;
  overlay: boolean;
  placement?: SurfaceOverlayPlacement;
  // Insertion order, so the surface focused most recently wins when two claim it.
  seq: number;
}

export type CodingAgentSurfaces = Record<string, CodingAgentSurface>;

export function noSurfaces(): CodingAgentSurfaces {
  return {};
}

export function applySurfaceEvent(surfaces: CodingAgentSurfaces, event: BridgeEvent): CodingAgentSurfaces {
  if (event.type === "surface_frame") {
    const previous = surfaces[event.surfaceId];
    return {
      ...surfaces,
      [event.surfaceId]: {
        surfaceId: event.surfaceId,
        slot: event.slot,
        lines: event.lines,
        focus: event.focus,
        overlay: event.overlay,
        placement: event.placement,
        seq: previous?.seq ?? nextSeq(surfaces),
      },
    };
  }
  if (event.type === "surface_closed") {
    if (!surfaces[event.surfaceId]) return surfaces;
    const { [event.surfaceId]: _closed, ...rest } = surfaces;
    return rest;
  }
  return surfaces;
}

export function chromeSurface(
  surfaces: CodingAgentSurfaces,
  kind: "footer" | "header" | "editor",
): CodingAgentSurface | undefined {
  return Object.values(surfaces).find((surface) => surface.slot.kind === kind);
}

export function widgetSurfaces(
  surfaces: CodingAgentSurfaces,
  placement: "aboveEditor" | "belowEditor",
): CodingAgentSurface[] {
  return Object.values(surfaces)
    .filter((surface) => surface.slot.kind === "widget" && (surface.slot.placement ?? "aboveEditor") === placement)
    .sort((a, b) => a.seq - b.seq);
}

export function toolSurface(
  surfaces: CodingAgentSurfaces,
  toolCallId: string,
  slot: "call" | "result",
): CodingAgentSurface | undefined {
  return Object.values(surfaces).find(
    (surface) => surface.slot.kind === "tool" && surface.slot.toolCallId === toolCallId && surface.slot.slot === slot,
  );
}

// The keyboard goes to one surface at a time. A dialog opened over another takes it, and hands it back when
// the container closes it — which is why the newest focused surface wins rather than the first found.
export function focusedSurface(surfaces: CodingAgentSurfaces): CodingAgentSurface | undefined {
  return Object.values(surfaces)
    .filter((surface) => surface.focus)
    .sort((a, b) => a.seq - b.seq)
    .at(-1);
}

function nextSeq(surfaces: CodingAgentSurfaces): number {
  return Object.values(surfaces).reduce((highest, surface) => Math.max(highest, surface.seq), 0) + 1;
}
