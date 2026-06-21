import { describe, expect, it } from "vitest";
import { logSafeOpts } from "./commander";

describe("commander logSafeOpts", () => {
  it("replaces spawn env VALUES with key names so proxy credentials never reach logs", () => {
    const safe = logSafeOpts({
      encoding: "utf-8",
      env: { PATH: "/usr/bin", HTTPS_PROXY: "socks5h://alice:secret@proxy.example.com:1080" },
    });

    expect(safe.env).toEqual(["PATH", "HTTPS_PROXY"]);
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("alice");
    expect(serialized).not.toContain("proxy.example.com");
  });

  it("leaves opts without an env untouched", () => {
    const opts = { encoding: "utf-8", cwd: "/tmp" };
    expect(logSafeOpts(opts)).toBe(opts);
    expect(logSafeOpts(undefined)).toBeUndefined();
  });
});
