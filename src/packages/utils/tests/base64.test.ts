import { describe, expect, it } from "vitest";

import { base64ToBytes, bytesToBase64, fromBase64, toBase64 } from "@/utils/base64";

describe("base64 over opaque bytes", () => {
  it("round-trips arbitrary bytes, including the ones no text encoding has a character for", () => {
    for (const bytes of [new Uint8Array(), new Uint8Array([0, 1, 2, 255]), new Uint8Array([0xc3, 0x28, 0xff, 0xfe])]) {
      expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
    }
  });

  it("agrees with the text conversion where the bytes happen to be text", () => {
    expect(bytesToBase64(new TextEncoder().encode("hello"))).toBe(toBase64("hello"));
  });

  // The whole reason this exists beside the text pair: a stream is cut wherever the network cut it, and decoding half
  // a codepoint as UTF-8 replaces it with U+FFFD — corrupting the answer instead of reassembling it.
  it("carries a multi-byte codepoint split across two chunks without corrupting it", () => {
    const whole = new TextEncoder().encode("日本語");
    const first = whole.slice(0, 4);
    const second = whole.slice(4);
    const rejoined = new Uint8Array([...base64ToBytes(bytesToBase64(first)), ...base64ToBytes(bytesToBase64(second))]);
    expect(new TextDecoder().decode(rejoined)).toBe("日本語");
  });
});

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
