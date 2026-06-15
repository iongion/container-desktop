// Find engine for React-rendered content (tables, key/value views). Uses the CSS Custom
// Highlight API so it never mutates the DOM: matches are painted via ::highlight() rules in
// Find.css. Works because the detail/list tables are non-virtualized (every row is present).

import { collectMatchRanges } from "./collectMatchRanges";
import type { FindEngine, FindEngineOptions, FindResults } from "./types";

const HIGHLIGHT_ALL = "cd-find";
const HIGHLIGHT_ACTIVE = "cd-find-active";

const highlightsSupported = typeof CSS !== "undefined" && "highlights" in CSS;

export function createDomFindEngine(getRoot: () => HTMLElement | null): FindEngine {
  let ranges: Range[] = [];
  let active = -1;
  let notify: ((results: FindResults) => void) | null = null;

  const emit = () => {
    notify?.({ index: ranges.length ? active + 1 : 0, count: ranges.length });
  };

  const removeHighlights = () => {
    if (!highlightsSupported) {
      return;
    }
    CSS.highlights.delete(HIGHLIGHT_ALL);
    CSS.highlights.delete(HIGHLIGHT_ACTIVE);
  };

  const paint = () => {
    if (!highlightsSupported) {
      return;
    }
    CSS.highlights.set(HIGHLIGHT_ALL, new Highlight(...ranges));
    const activeRange = active >= 0 ? ranges[active] : undefined;
    if (activeRange) {
      CSS.highlights.set(HIGHLIGHT_ACTIVE, new Highlight(activeRange));
      activeRange.startContainer.parentElement?.scrollIntoView({ block: "nearest", inline: "nearest" });
    } else {
      CSS.highlights.delete(HIGHLIGHT_ACTIVE);
    }
  };

  return {
    apply(query, options: FindEngineOptions) {
      const root = getRoot();
      ranges = root && query ? collectMatchRanges(root, query, options.caseSensitive) : [];
      active = ranges.length ? 0 : -1;
      if (ranges.length) {
        paint();
      } else {
        removeHighlights();
      }
      emit();
    },
    next() {
      if (!ranges.length) {
        return;
      }
      active = (active + 1) % ranges.length;
      paint();
      emit();
    },
    previous() {
      if (!ranges.length) {
        return;
      }
      active = (active - 1 + ranges.length) % ranges.length;
      paint();
      emit();
    },
    clear() {
      ranges = [];
      active = -1;
      removeHighlights();
      emit();
    },
    subscribe(callback) {
      notify = callback;
      return () => {
        if (notify === callback) {
          notify = null;
        }
      };
    },
  };
}
