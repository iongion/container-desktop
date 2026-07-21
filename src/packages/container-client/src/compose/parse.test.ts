import { describe, expect, it } from "vitest";

import { ComposeParseError, parseComposeYaml } from "./parse";

describe("compose parseComposeYaml", () => {
  it("parses a compose document into a plain object", () => {
    const doc = parseComposeYaml("services:\n  web:\n    image: nginx");
    expect(doc).toEqual({ services: { web: { image: "nginx" } } });
  });

  it("resolves YAML anchors and aliases", () => {
    const doc = parseComposeYaml("a: &ref hello\nb: *ref") as Record<string, unknown>;
    expect(doc.a).toBe("hello");
    expect(doc.b).toBe("hello");
  });

  it("throws ComposeParseError on malformed YAML", () => {
    expect(() => parseComposeYaml("key: 'unterminated")).toThrow(ComposeParseError);
  });

  it("throws ComposeParseError when the document is not a mapping", () => {
    expect(() => parseComposeYaml("- just\n- a\n- list")).toThrow(ComposeParseError);
  });
});
