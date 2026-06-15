// Find engine for xterm terminals (Logs, interactive Terminal). Wraps the SearchAddon the
// Terminal already loads; decorations highlight every match and the active one, and
// onDidChangeResults drives the "x of N" counter. xterm handles scroll-into-view itself.

import type { SearchAddon } from "@xterm/addon-search";

import { readTerminalDecorations } from "./findDecorations";
import type { FindEngine, FindEngineOptions, FindResults } from "./types";

export function createTerminalFindEngine(getAddon: () => SearchAddon | null): FindEngine {
  let query = "";
  let caseSensitive = false;

  const options = (incremental: boolean) => ({
    incremental,
    caseSensitive,
    decorations: readTerminalDecorations(),
  });

  return {
    apply(nextQuery, opts: FindEngineOptions) {
      query = nextQuery;
      caseSensitive = opts.caseSensitive;
      const addon = getAddon();
      if (!addon) {
        return;
      }
      if (!query) {
        addon.clearDecorations();
        return;
      }
      addon.findNext(query, options(true));
    },
    next() {
      if (query) {
        getAddon()?.findNext(query, options(false));
      }
    },
    previous() {
      if (query) {
        getAddon()?.findPrevious(query, options(false));
      }
    },
    clear() {
      query = "";
      getAddon()?.clearDecorations();
    },
    subscribe(callback: (results: FindResults) => void) {
      const disposable = getAddon()?.onDidChangeResults((event) => {
        callback({
          index: event.resultIndex >= 0 ? event.resultIndex + 1 : 0,
          count: event.resultCount,
        });
      });
      return () => disposable?.dispose();
    },
  };
}
