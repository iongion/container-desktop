import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  createAppIndicatorShimEnv,
  parseLdconfigPath,
  parseSingleLibDir,
  renderPcFile,
} = require("../tauri-appindicator-shim.cjs");

const SO = "libayatana-appindicator3.so.1";
const PC = "ayatana-appindicator3-0.1";

describe("parseLdconfigPath", () => {
  it("extracts the library path from ldconfig -p output", () => {
    const out = [
      "libs listed:",
      `\t${SO} (libc6,x86-64) => /usr/lib/${SO}`,
      "\tlibfoo.so.1 => /usr/lib/libfoo.so.1",
    ].join("\n");
    expect(parseLdconfigPath(out, SO)).toBe(`/usr/lib/${SO}`);
  });

  it("returns null when the library is absent", () => {
    expect(parseLdconfigPath("\tlibfoo.so.1 => /usr/lib/libfoo.so.1", SO)).toBeNull();
  });
});

describe("parseSingleLibDir", () => {
  it("returns the directory for a single -L flag", () => {
    expect(parseSingleLibDir("-L/usr/lib\n")).toBe("/usr/lib");
  });

  it("returns null for multiple -L flags (the Void multi--L case)", () => {
    expect(parseSingleLibDir("-L/usr/lib64 -L/usr/lib -L/usr/lib64")).toBeNull();
  });

  it("returns null for empty output", () => {
    expect(parseSingleLibDir("")).toBeNull();
    expect(parseSingleLibDir("   ")).toBeNull();
  });
});

describe("renderPcFile", () => {
  it("emits a single -L with no Requires so pkg-config yields one clean path", () => {
    const pc = renderPcFile("/usr/lib");
    expect(pc).toContain("libdir=/usr/lib");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserts the literal pkg-config variable
    expect(pc).toContain("Libs: -L${libdir} -layatana-appindicator3");
    expect(pc).toContain(`Name: ${PC}`);
    expect(pc).toContain("Version:");
    expect(pc).not.toMatch(/^Requires/m);
  });
});

function makeIo(overrides = {}) {
  const calls = { writeShim: [] as Array<{ dir: string; content: string }> };
  const io = {
    ldconfig: () => `\t${SO} (libc6,x86-64) => /usr/lib/${SO}`,
    pkgConfigLibs: () => "-L/usr/lib64 -L/usr/lib -L/usr/lib64",
    exists: (p: string) => p === `/usr/lib/${SO}`,
    realpath: (p: string) => p,
    writeShim: (dir: string, content: string) => {
      calls.writeShim.push({ dir, content });
      return dir;
    },
    ...overrides,
  };
  return { io, calls };
}

describe("createAppIndicatorShimEnv", () => {
  it("is a no-op on non-Linux platforms", () => {
    const { io, calls } = makeIo();
    expect(createAppIndicatorShimEnv({ platform: "darwin", io, cacheDir: "/tmp/shim", env: {} })).toEqual({});
    expect(calls.writeShim).toHaveLength(0);
  });

  it("writes a clean shim and sets PKG_CONFIG_PATH when pkg-config emits multiple -L", () => {
    const { io, calls } = makeIo();
    const env = createAppIndicatorShimEnv({ platform: "linux", io, cacheDir: "/tmp/shim", env: {} });
    expect(env).toEqual({ PKG_CONFIG_PATH: "/tmp/shim" });
    expect(calls.writeShim).toHaveLength(1);
    expect(calls.writeShim[0].dir).toBe("/tmp/shim");
    expect(calls.writeShim[0].content).not.toMatch(/^Requires/m);
  });

  it("preserves an existing PKG_CONFIG_PATH by appending it after the shim dir", () => {
    const { io } = makeIo();
    const env = createAppIndicatorShimEnv({
      platform: "linux",
      io,
      cacheDir: "/tmp/shim",
      env: { PKG_CONFIG_PATH: "/existing" },
    });
    expect(env.PKG_CONFIG_PATH).toBe(`/tmp/shim${path.delimiter}/existing`);
  });

  it("is a no-op when pkg-config already resolves a single valid -L", () => {
    const { io, calls } = makeIo({ pkgConfigLibs: () => "-L/usr/lib" });
    expect(createAppIndicatorShimEnv({ platform: "linux", io, cacheDir: "/tmp/shim", env: {} })).toEqual({});
    expect(calls.writeShim).toHaveLength(0);
  });

  it("is a no-op when the runtime library cannot be found", () => {
    const { io, calls } = makeIo({ ldconfig: () => "", exists: () => false });
    expect(createAppIndicatorShimEnv({ platform: "linux", io, cacheDir: "/tmp/shim", env: {} })).toEqual({});
    expect(calls.writeShim).toHaveLength(0);
  });
});
