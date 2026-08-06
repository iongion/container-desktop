import { describe, expect, it } from "vitest";

import { chunkPayload } from "@/pi-agent-host/sessionStorageChannel";

// The window is fixed and a conversation is not, so every answer bigger than the window crosses in pieces. What has to
// hold is that the pieces reassemble byte-for-byte and that `more` is false exactly once — on the last one. A `more`
// that lied would leave the blocked caller waiting for a chunk nobody is going to write.

function reassemble(bytes: Uint8Array, windowBytes: number): { text: string; chunks: number; mores: boolean[] } {
  const parts: number[] = [];
  const mores: boolean[] = [];
  let chunks = 0;
  for (const chunk of chunkPayload(bytes, windowBytes)) {
    parts.push(...chunk.bytes);
    mores.push(chunk.more);
    chunks++;
  }
  return { text: new TextDecoder().decode(new Uint8Array(parts)), chunks, mores };
}

const encode = (text: string) => new TextEncoder().encode(text);

describe("chunkPayload", () => {
  it("hands a small answer over in one piece", () => {
    const result = reassemble(encode("hello"), 1024);
    expect(result).toMatchObject({ text: "hello", chunks: 1, mores: [false] });
  });

  it("still yields one chunk for an empty answer, because the caller is blocked waiting for something", () => {
    const result = reassemble(encode(""), 1024);
    expect(result).toMatchObject({ text: "", chunks: 1, mores: [false] });
  });

  it("cuts a long answer into windows that reassemble exactly", () => {
    const text = "x".repeat(2500);
    const result = reassemble(encode(text), 1000);
    expect(result.text).toBe(text);
    expect(result.chunks).toBe(3);
    expect(result.mores).toEqual([true, true, false]);
  });

  it("does not report one more chunk when the answer fills the last window exactly", () => {
    // The off-by-one that would wedge the caller: it drains on `more`, so a final `true` leaves it waiting forever.
    const result = reassemble(encode("y".repeat(2000)), 1000);
    expect(result.chunks).toBe(2);
    expect(result.mores).toEqual([true, false]);
  });

  it("carries bytes, not characters, so a multi-byte character split across windows survives", () => {
    // A conversation holds whatever the user typed. Splitting on characters would corrupt any emoji that straddled a
    // window; the caller decodes the concatenated BYTES, which is why the chunks are byte ranges.
    const text = "😀".repeat(40);
    const bytes = encode(text);
    const result = reassemble(bytes, 7);
    expect(result.text).toBe(text);
    expect(result.chunks).toBeGreaterThan(1);
  });
});
