// Decides what Ctrl/Cmd+F should do on the currently active screen. Exactly one screen is
// mounted at a time (TanStack Router swaps routes), so we resolve against the single live
// `.AppScreenContent`. Routing is by content, not focus:
//   terminal -> our overlay driven by SearchAddon
//   monaco   -> open Monaco's own native find (kept as-is, it's full-featured)
//   filter   -> focus the list screen's existing row-filter input
//   dom      -> our overlay driven by the CSS Custom Highlight API
//   none     -> nothing searchable; let the key fall through

import { type FindTarget, findTargetWithin } from "./findTargets";

export type FindRouteKind = "terminal" | "monaco" | "filter" | "dom" | "none";

export interface FindRoute {
  kind: FindRouteKind;
  root: HTMLElement | null;
  target?: FindTarget;
  filterInput?: HTMLInputElement;
}

// The scrollable content of the active screen (with sensible fallbacks).
export function getActiveContentRoot(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(".AppScreenViewport .AppScreenContent") ??
    document.querySelector<HTMLElement>(".AppScreenContent") ??
    document.querySelector<HTMLElement>(".AppScreenViewport")
  );
}

export function resolveFindRoute(): FindRoute {
  const root = getActiveContentRoot();
  if (!root) {
    return { kind: "none", root: null };
  }
  const target = findTargetWithin(root);
  if (target?.type === "terminal") {
    return { kind: "terminal", root, target };
  }
  if (target?.type === "monaco") {
    return { kind: "monaco", root, target };
  }
  // List screens render a row-filter input in their header (a sibling of the content).
  const filterInput =
    document.querySelector<HTMLInputElement>('.AppScreenViewport .AppScreenHeader input[type="search"]') ??
    document.querySelector<HTMLInputElement>('.AppScreenHeader input[type="search"]') ??
    undefined;
  if (filterInput) {
    return { kind: "filter", root, filterInput };
  }
  return { kind: "dom", root };
}
