// Shared contract for the global find feature. A FindEngine knows how to search a
// particular kind of content (xterm terminal buffer, or React DOM via the CSS Custom
// Highlight API); the FindHost/FindWidget drive whichever engine the active screen needs.

export interface FindResults {
  // 1-based index of the active match, or 0 when there are none.
  index: number;
  // Total number of matches.
  count: number;
}

export interface FindEngineOptions {
  caseSensitive: boolean;
}

export interface FindEngine {
  // (Re)compute matches, highlight all of them and activate the first.
  apply(query: string, options: FindEngineOptions): void;
  // Move the active match forward (wraps).
  next(): void;
  // Move the active match backward (wraps).
  previous(): void;
  // Remove every highlight/decoration this engine created.
  clear(): void;
  // Subscribe to result changes; returns an unsubscribe function.
  subscribe(callback: (results: FindResults) => void): () => void;
}
