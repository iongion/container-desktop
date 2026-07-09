// Tiny registry letting content that the global FindHost can't reach through the DOM
// advertise how to be searched. Two kinds register here:
//   - xterm terminals expose their SearchAddon (the buffer isn't real DOM text)
//   - Monaco editors expose a way to open their own native find widget
// The host resolves the right target by checking which registered element lives inside
// the active screen's content root.

import type { SearchAddon } from "@xterm/addon-search";

export type FindTarget =
  | { type: "terminal"; el: HTMLElement; getSearchAddon: () => SearchAddon | null }
  | { type: "monaco"; el: HTMLElement; openFind: () => void };

const targets = new Set<FindTarget>();

export function registerFindTarget(target: FindTarget): () => void {
  targets.add(target);
  return () => {
    targets.delete(target);
  };
}

// Returns the registered target whose element is contained by `root`, if any.
export function findTargetWithin(root: HTMLElement | null): FindTarget | undefined {
  if (!root) {
    return undefined;
  }
  for (const target of targets) {
    if (target.el && root.contains(target.el)) {
      return target;
    }
  }
  return undefined;
}
