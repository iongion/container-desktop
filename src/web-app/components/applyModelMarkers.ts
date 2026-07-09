// Standalone (no monaco-setup side effects) helper that pushes marker data onto a Monaco editor's model.
// Kept separate from CodeEditorImpl so it is unit-testable without importing the heavy monaco bundle. The
// `import type` is erased at build time, so this module pulls nothing into the main chunk.

import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

export const MARKER_OWNER = "containerfile-linter";

// Set (or clear) markers on the editor's model. Returns false when monaco/the model is not ready yet.
export function applyModelMarkers(
  monaco: typeof Monaco | null | undefined,
  editor: Monaco.editor.IStandaloneCodeEditor | null | undefined,
  markers: Monaco.editor.IMarkerData[] | undefined,
): boolean {
  const model = editor?.getModel?.();
  if (!monaco || !model) {
    return false;
  }
  monaco.editor.setModelMarkers(model, MARKER_OWNER, markers ?? []);
  return true;
}
