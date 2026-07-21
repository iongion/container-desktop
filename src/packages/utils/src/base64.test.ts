import { describe, expect, it } from "vitest";

import { fromBase64, toBase64 } from "./base64";

describe("base64", () => {
  it("round-trips UTF-8 (incl. multi-byte) through to/from", () => {
    for (const s of ["", "hello", "a=b&c=d", "FROM alpine\nRUN echo hi", "café — 日本語 — 🚀"]) {
      expect(fromBase64(toBase64(s))).toBe(s);
    }
  });

  it("toBase64 matches the standard base64 alphabet (btoa-compatible)", () => {
    expect(toBase64("hello")).toBe("aGVsbG8=");
    expect(toBase64("")).toBe("");
  });

  it("fromBase64 decodes standard base64", () => {
    expect(fromBase64("aGVsbG8=")).toBe("hello");
  });
});
