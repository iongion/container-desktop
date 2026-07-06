import { describe, expect, it } from "vitest";

import { InterpolationError, interpolateString, interpolateTree } from "./interpolate";

describe("compose interpolateString", () => {
  const env = { NAME: "web", EMPTY: "", PORT: "8080" };

  it("substitutes ${VAR} from the environment", () => {
    expect(interpolateString("image: nginx:${PORT}", env)).toBe("image: nginx:8080");
  });

  it("substitutes bare $VAR", () => {
    expect(interpolateString("svc-$NAME", env)).toBe("svc-web");
  });

  it("expands an unset ${VAR} to an empty string", () => {
    expect(interpolateString("a${MISSING}b", env)).toBe("ab");
  });

  it("${VAR:-default} uses default when unset OR empty", () => {
    expect(interpolateString("${MISSING:-fallback}", env)).toBe("fallback");
    expect(interpolateString("${EMPTY:-fallback}", env)).toBe("fallback");
    expect(interpolateString("${NAME:-fallback}", env)).toBe("web");
  });

  it("${VAR-default} uses default only when unset (empty stays empty)", () => {
    expect(interpolateString("${MISSING-fallback}", env)).toBe("fallback");
    expect(interpolateString("x${EMPTY-fallback}y", env)).toBe("xy");
  });

  it("${VAR:?msg} throws when unset or empty", () => {
    expect(() => interpolateString("${MISSING:?required}", env)).toThrow(InterpolationError);
    expect(() => interpolateString("${EMPTY:?required}", env)).toThrow(/required/);
  });

  it("${VAR?msg} throws only when unset", () => {
    expect(() => interpolateString("${MISSING?required}", env)).toThrow(InterpolationError);
    expect(interpolateString("${EMPTY?required}", env)).toBe("");
  });

  it("$$ is an escaped literal dollar (no expansion)", () => {
    expect(interpolateString("price is $$5", env)).toBe("price is $5");
    expect(interpolateString("$${NAME}", env)).toBe("${NAME}");
  });

  it("resolves multiple references in one string", () => {
    expect(interpolateString("${NAME}:${PORT}", env)).toBe("web:8080");
  });

  it("resolves nested defaults ${A:-${B}} (balanced braces, not first-} truncation)", () => {
    expect(interpolateString("${MISSING:-${NAME}}", env)).toBe("web");
    expect(interpolateString("${MISSING:-${ALSO_MISSING:-deep}}", env)).toBe("deep");
    expect(interpolateString("${NAME:+${PORT}}", env)).toBe("8080");
  });

  it("rejects unsupported shell forms (pattern replacement, etc.)", () => {
    expect(() => interpolateString("${NAME/foo/bar}", env)).toThrow(InterpolationError);
    expect(() => interpolateString("${NAME#pre}", env)).toThrow(InterpolationError);
  });

  it("throws on an unterminated ${", () => {
    expect(() => interpolateString("${NAME", env)).toThrow(InterpolationError);
  });
});

describe("compose interpolateTree", () => {
  const env = { TAG: "1.2", HOST_PORT: "8080" };

  it("substitutes in every nested string value, leaving keys and non-strings intact", () => {
    const tree = {
      services: { web: { image: "nginx:${TAG}", ports: ["${HOST_PORT}:80"], replicas: 3, tls: true } },
    };
    expect(interpolateTree(tree, env)).toEqual({
      services: { web: { image: "nginx:1.2", ports: ["8080:80"], replicas: 3, tls: true } },
    });
  });
});
