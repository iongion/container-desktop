import { lazy, Suspense } from "react";

import type { CodeEditorProps } from "./CodeEditorImpl";

// Monaco (~10 MB — the single biggest passenger in the renderer bundle) is lazy-loaded so it stays OFF
// the first-paint path. It loads only when a CodeEditor actually mounts (Inspect / Info / Kube / AI
// screens). The `import type` above is erased at build time, so it does NOT pull the impl into the main
// chunk — only the dynamic import() below creates the (Monaco) chunk.
const CodeEditorImpl = lazy(() => import("./CodeEditorImpl"));

export type { CodeEditorProps };

export function CodeEditor(props: CodeEditorProps) {
  return (
    <Suspense fallback={<div className="CodeEditor CodeEditorLoading" style={{ height: "100%" }} />}>
      <CodeEditorImpl {...props} />
    </Suspense>
  );
}
