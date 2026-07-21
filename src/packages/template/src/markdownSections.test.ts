import { describe, expect, it } from "vitest";
import { parseMarkdownSections } from "./markdownSections";

describe("parseMarkdownSections", () => {
  it("indexes level-two sections and preserves their markdown body", () => {
    expect(
      parseMarkdownSections("# Definitions\n\n## first\nFirst line.\n\n- detail\n\n## second\nSecond line.\n"),
    ).toEqual({ first: "First line.\n\n- detail", second: "Second line." });
  });

  it("rejects duplicate and empty section names", () => {
    expect(() => parseMarkdownSections("## same\none\n## same\ntwo")).toThrow("duplicate");
    expect(() => parseMarkdownSections("##   \nbody")).toThrow("empty");
  });
});
