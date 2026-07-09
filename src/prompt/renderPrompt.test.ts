import { describe, expect, it } from "vitest";

import { renderPrompt } from "./renderPrompt";

describe("renderPrompt — nunjucks template engine", () => {
  it("renders a plain string unchanged", () => {
    expect(renderPrompt("hello world", {})).toBe("hello world");
  });

  it("interpolates variables", () => {
    expect(renderPrompt("Hello {{ name }}!", { name: "Alice" })).toBe("Hello Alice!");
  });

  it("trims leading and trailing whitespace", () => {
    expect(renderPrompt("\n  hello  \n", {})).toBe("hello");
  });

  it("includes a block when the condition is truthy", () => {
    const tpl = "Base\n{% if show %}\nExtra content\n{% endif %}";
    const result = renderPrompt(tpl, { show: true });
    expect(result).toContain("Extra content");
  });

  it("excludes a block when the condition is falsy", () => {
    const tpl = "Base\n{% if show %}\nExtra content\n{% endif %}";
    const result = renderPrompt(tpl, { show: false });
    expect(result).toBe("Base");
    expect(result).not.toContain("Extra");
  });

  it("handles multiple conditions", () => {
    const tpl = "{% if a %}A{% endif %}{% if b %}B{% endif %}{% if c %}C{% endif %}";
    expect(renderPrompt(tpl, { a: true, b: false, c: true })).toBe("AC");
  });

  it("does not auto-escape HTML (autoescape:false)", () => {
    expect(renderPrompt("{{ code }}", { code: "<div>hello</div>" })).toBe("<div>hello</div>");
  });

  it("handles equality comparison", () => {
    const tpl = "{% if kind === 'x' %}got x{% else %}other{% endif %}";
    expect(renderPrompt(tpl, { kind: "x" })).toBe("got x");
    expect(renderPrompt(tpl, { kind: "y" })).toBe("other");
  });
});
