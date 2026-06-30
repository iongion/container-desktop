import { lazy, Suspense } from "react";

import type { TerminalProps } from "./TerminalImpl";

// xterm + its 4 addons (fit/search/unicode11/webgl) are lazy-loaded so they stay OFF the first-paint
// path — they load only when a Terminal actually mounts (container/pod Logs + interactive Terminal
// screens). The `import type`/`export type` below are erased at build time, so they do NOT pull the impl
// into the main chunk; only the dynamic import() creates the (xterm) chunk.
export type { TerminalHandle, TerminalProps, TerminalWriteMode } from "./TerminalImpl";

const TerminalImpl = lazy(() => import("./TerminalImpl"));

export function Terminal(props: TerminalProps) {
  return (
    <Suspense fallback={<div className="TerminalView TerminalLoading" />}>
      <TerminalImpl {...props} />
    </Suspense>
  );
}
