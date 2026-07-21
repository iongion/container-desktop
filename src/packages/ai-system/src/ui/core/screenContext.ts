// A compact, model-facing description of the SCREEN the user is currently looking at, so the assistant can
// answer questions "about this screen" without being told. Kept pure (plain inputs: the active screen's
// id/title, optional per-screen focus guidance, and an optional on-screen detail line) so it is unit-tested
// without React. The renderer fills these from the router + the per-screen prompt registry; the broker
// redacts the whole bundle before egress like any other context. Sibling of resourceContext.ts (which
// summarizes the live resources) — this one adds "where the user is".

export interface ScreenContextInput {
  // The active screen's stable id (e.g. "containers", "image.security") and human title (e.g. "Containers").
  id?: string;
  title?: string;
  // Curated, model-facing guidance for this screen (from the per-screen prompt registry). English, not shown.
  focus?: string;
  // Optional compact snapshot of what is visible/selected on the screen.
  detail?: string;
}

export function buildScreenContext({ id, title, focus, detail }: ScreenContextInput): string {
  if (!id && !title) {
    return "";
  }
  const label = title ?? id;
  const lines = [`The user is currently viewing the "${label}" screen${id ? ` (id: ${id})` : ""}.`];
  if (focus?.trim()) {
    lines.push(focus.trim());
  }
  if (detail?.trim()) {
    lines.push(detail.trim());
  }
  return lines.join("\n");
}
