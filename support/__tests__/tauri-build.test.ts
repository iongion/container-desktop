import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createTauriBuildCommand } = require("../tauri-build.cjs");

const base = {
  hostPlatform: "linux",
  hostArch: "x64",
  command: "tauri",
  commandExists: () => true,
};

describe("createTauriBuildCommand appindicator shim", () => {
  it("merges the shim PKG_CONFIG_PATH into the build env for `build`", () => {
    const build = createTauriBuildCommand({
      ...base,
      args: ["build", "--bundles", "appimage"],
      createAppIndicatorShimEnv: () => ({ PKG_CONFIG_PATH: "/shim" }),
    });
    expect(build.env).toEqual({ PKG_CONFIG_PATH: "/shim" });
  });

  it("preserves caller-provided env alongside the shim", () => {
    const build = createTauriBuildCommand({
      ...base,
      args: ["build"],
      env: { FOO: "bar" },
      createAppIndicatorShimEnv: () => ({ PKG_CONFIG_PATH: "/shim" }),
    });
    expect(build.env).toEqual({ FOO: "bar", PKG_CONFIG_PATH: "/shim" });
  });

  it("does not apply the shim to non-build subcommands (e.g. dev)", () => {
    const build = createTauriBuildCommand({
      ...base,
      args: ["dev"],
      createAppIndicatorShimEnv: () => ({ PKG_CONFIG_PATH: "/shim" }),
    });
    expect(build.env).toBeUndefined();
  });

  it("leaves env undefined when the shim is a no-op", () => {
    const build = createTauriBuildCommand({
      ...base,
      args: ["build"],
      createAppIndicatorShimEnv: () => ({}),
    });
    expect(build.env).toBeUndefined();
  });
});
