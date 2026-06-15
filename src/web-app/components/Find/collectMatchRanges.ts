// Pure DOM walk that returns a Range for every occurrence of `query` in the visible text
// under `root`. Kept free of any CSS.highlights side effects so it can be unit-tested in
// jsdom. Skips empty/whitespace-only text nodes, <script>/<style>, and the find widget's
// own chrome so it never matches itself.

export function collectMatchRanges(root: Node, query: string, caseSensitive: boolean): Range[] {
  const ranges: Range[] = [];
  if (!query) {
    return ranges;
  }
  const needle = caseSensitive ? query : query.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue?.trim()) {
        return NodeFilter.FILTER_REJECT;
      }
      const parent = node.parentElement;
      if (!parent) {
        return NodeFilter.FILTER_REJECT;
      }
      if (parent.tagName === "SCRIPT" || parent.tagName === "STYLE") {
        return NodeFilter.FILTER_REJECT;
      }
      if (parent.closest(".ContainerFindWidget")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue as string;
    const haystack = caseSensitive ? text : text.toLowerCase();
    let from = haystack.indexOf(needle);
    while (from !== -1) {
      const range = document.createRange();
      range.setStart(node, from);
      range.setEnd(node, from + query.length);
      ranges.push(range);
      from = haystack.indexOf(needle, from + Math.max(needle.length, 1));
    }
  }
  return ranges;
}
