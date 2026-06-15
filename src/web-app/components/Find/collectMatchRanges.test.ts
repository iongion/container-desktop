import { describe, expect, it } from "vitest";

import { collectMatchRanges } from "./collectMatchRanges";

function setup(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe("collectMatchRanges", () => {
  it("returns no ranges for an empty query", () => {
    const root = setup("<p>hello world</p>");
    expect(collectMatchRanges(root, "", false)).toEqual([]);
  });

  it("finds case-insensitive matches across sibling nodes", () => {
    const root = setup("<p>Error</p><span>another error here</span>");
    const ranges = collectMatchRanges(root, "error", false);
    expect(ranges).toHaveLength(2);
    expect(ranges[0].toString().toLowerCase()).toBe("error");
  });

  it("respects case sensitivity", () => {
    const root = setup("<p>Error and error</p>");
    expect(collectMatchRanges(root, "error", true)).toHaveLength(1);
    expect(collectMatchRanges(root, "error", false)).toHaveLength(2);
  });

  it("counts repeated non-overlapping matches", () => {
    const root = setup("<p>aaaa</p>");
    expect(collectMatchRanges(root, "aa", false)).toHaveLength(2);
  });

  it("ignores text inside the find widget's own chrome", () => {
    const root = setup('<div class="ContainerFindWidget">error</div><p>error</p>');
    expect(collectMatchRanges(root, "error", false)).toHaveLength(1);
  });
});
