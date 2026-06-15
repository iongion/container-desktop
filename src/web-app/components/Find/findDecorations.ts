import type { ISearchOptions } from "@xterm/addon-search";

// xterm decoration colours are read from CSS vars so they follow the active engine. The
// terminal surface is always dark, so these track engine (docker/podman) rather than
// light/dark. matchBackground/activeMatchBackground must be #RRGGBB per the addon contract.
export function readTerminalDecorations(): ISearchOptions["decorations"] {
  const styles = getComputedStyle(document.body);
  const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  const match = read("--find-term-match", "#24487e");
  const active = read("--find-term-active", "#6caaff");
  return {
    matchBackground: match,
    matchBorder: match,
    matchOverviewRuler: active,
    activeMatchBackground: active,
    activeMatchBorder: active,
    activeMatchColorOverviewRuler: active,
  };
}
