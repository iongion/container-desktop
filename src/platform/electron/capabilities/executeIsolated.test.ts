import { describe, expect, it } from "vitest";

import { createNodeExecuteIsolated } from "./executeIsolated";

// These characterize the load-bearing property of the ExecuteIsolated port: the child env is REPLACED
// WHOLESALE with exactly opts.env — never merged with the parent's process.env / proxy env (that is what
// ICommand.Execute does, and precisely what this capability must NOT do). Hermetic + cross-platform: we spawn
// the very Node binary running the tests via -e, so no fixtures and nothing to install.
const NODE = process.execPath;

// The minimum a Node child needs to start; each test's point is what is ABSENT from this map.
const baseEnv = (): Record<string, string> => ({ PATH: process.env.PATH ?? "" });

describe("createNodeExecuteIsolated (ExecuteIsolated port)", () => {
  it("replaces the child env WHOLESALE with opts.env — an inherited secret does not leak in", async () => {
    const prev = process.env.CD_LEAK_SECRET;
    process.env.CD_LEAK_SECRET = "topsecret-inherited";
    try {
      const exec = createNodeExecuteIsolated();
      const result = await exec(NODE, ["-e", "process.stdout.write(String(process.env.CD_LEAK_SECRET))"], {
        cwd: process.cwd(),
        env: baseEnv(),
        timeout: 10_000,
      });
      expect(result.success).toBe(true);
      // The parent HAS the secret; the isolated child must see `undefined`.
      expect(result.stdout).toBe("undefined");
    } finally {
      if (prev === undefined) {
        delete process.env.CD_LEAK_SECRET;
      } else {
        process.env.CD_LEAK_SECRET = prev;
      }
    }
  });

  it("does NOT merge proxy env into the child (the ICommand.Execute merge is exactly what it avoids)", async () => {
    const prev = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = "http://leak.example:8080";
    try {
      const exec = createNodeExecuteIsolated();
      const result = await exec(NODE, ["-e", "process.stdout.write(String(process.env.HTTPS_PROXY))"], {
        cwd: process.cwd(),
        env: baseEnv(),
        timeout: 10_000,
      });
      expect(result.stdout).toBe("undefined");
    } finally {
      if (prev === undefined) {
        delete process.env.HTTPS_PROXY;
      } else {
        process.env.HTTPS_PROXY = prev;
      }
    }
  });

  it("delivers exactly the vars in opts.env to the child", async () => {
    const exec = createNodeExecuteIsolated();
    const result = await exec(NODE, ["-e", "process.stdout.write(String(process.env.CD_ALLOWED))"], {
      cwd: process.cwd(),
      env: { ...baseEnv(), CD_ALLOWED: "delivered" },
      timeout: 10_000,
    });
    expect(result.stdout).toBe("delivered");
  });

  it("runs args as an ARRAY with no shell — metacharacters are passed through inert", async () => {
    const exec = createNodeExecuteIsolated();
    // Under a shell, `$(…)` would be command-substituted; as an args array it reaches argv verbatim.
    const result = await exec(NODE, ["-e", "process.stdout.write(process.argv[1])", "$(echo pwned)"], {
      cwd: process.cwd(),
      env: baseEnv(),
      timeout: 10_000,
    });
    expect(result.stdout).toBe("$(echo pwned)");
  });
});
