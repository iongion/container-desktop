import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isPiBashOutputPath, readToolOutput } from "@/pi-agent-host/toolOutput";

describe("isPiBashOutputPath", () => {
  it("accepts the file pi's bash executor actually writes", () => {
    expect(isPiBashOutputPath(join(tmpdir(), "pi-bash-abc123.log"))).toBe(true);
  });

  it("refuses anything else in the temp dir", () => {
    expect(isPiBashOutputPath(join(tmpdir(), "secrets.log"))).toBe(false);
    expect(isPiBashOutputPath(join(tmpdir(), "pi-bash-abc.txt"))).toBe(false);
  });

  it("refuses a path outside the temp dir, including one that walks out of it", () => {
    expect(isPiBashOutputPath("/etc/passwd")).toBe(false);
    expect(isPiBashOutputPath("/workspace/pi-bash-abc.log")).toBe(false);
    expect(isPiBashOutputPath(join(tmpdir(), "..", "etc", "pi-bash-abc.log"))).toBe(false);
  });

  it("refuses a nested path, so a subdirectory cannot smuggle the suffix", () => {
    expect(isPiBashOutputPath(join(tmpdir(), "nested", "pi-bash-abc.log"))).toBe(false);
  });
});

describe("readToolOutput", () => {
  it("reads the whole file when it fits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-bash-fixture-"));
    const file = join(tmpdir(), `pi-bash-${dir.slice(-6)}.log`);
    await writeFile(file, "line one\nline two\n");
    await expect(readToolOutput(file)).resolves.toEqual({ text: "line one\nline two\n", truncated: false });
  });

  it("refuses a path pi did not write, rather than reading it", async () => {
    await expect(readToolOutput("/etc/passwd")).rejects.toThrow(/not a pi tool-output file/);
  });

  it("keeps the TAIL when the file is over the cap — the end is where a failure is", async () => {
    const file = join(tmpdir(), "pi-bash-oversized.log");
    await writeFile(file, `${"a".repeat(200)}THE-END`);
    const result = await readToolOutput(file, 32);
    expect(result.truncated).toBe(true);
    expect(result.text.endsWith("THE-END")).toBe(true);
    expect(result.text.length).toBe(32);
  });
});
