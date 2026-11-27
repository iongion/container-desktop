import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  createAppIndicatorShimEnv,
  parseLdconfigPath,
  parseSingleLibDir,
  renderPcFile,
  rewriteGtkPcLibdir,
} = require("../tauri-appindicator-shim.cjs");

const SO = "libayatana-appindicator3.so.1";
const PC = "ayatana-appindicator3-0.1";

// A representative Void gtk+-3.0.pc: libdir points at the /usr/lib64 symlink while the real
// modules live under /usr/lib. `$` is interpolated so these stay genuine template literals.
const V = "$";
const GTK_PC_SOURCE = [
  "prefix=/usr",
  `exec_prefix=${V}{prefix}`,
  `libdir=${V}{prefix}/lib64`,
  `includedir=${V}{prefix}/include`,
  "targets=broadway wayland x11",
  "gtk_binary_version=3.0.0",
  "gtk_host=x86_64-linux",
  "",
  "Name: GTK+",
  "Description: GTK+ Graphical UI Library",
  "Version: 3.24.52",
  "Requires: gdk-3.0 atk >= 2.35.1 cairo >= 1.14.0",
  `Libs: -L${V}{libdir} -lgtk-3`,
  `Cflags: -I${V}{includedir}/gtk-3.0`,
  "",
].join("\n");

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
  const calls = {
    writeShim: [] as Array<{ dir: string; content: string }>,
    writeGtkPc: [] as Array<{ dir: string; content: string }>,
  };
  const io = {
    ldconfig: () => `\t${SO} (libc6,x86-64) => /usr/lib/${SO}`,
    pkgConfigLibs: () => "-L/usr/lib64 -L/usr/lib -L/usr/lib64",
    // By default gtk+-3.0 is "absent" so the GTK canonicalization is a no-op in appindicator tests.
    pkgConfigVariable: () => "",
    readFile: () => "",
    exists: (p: string) => p === `/usr/lib/${SO}`,
    realpath: (p: string) => p,
    writeShim: (dir: string, content: string) => {
      calls.writeShim.push({ dir, content });
      return dir;
    },
    writeGtkPc: (dir: string, content: string) => {
      calls.writeGtkPc.push({ dir, content });
      return dir;
    },
    ...overrides,
  };
  return { io, calls };
}

// A Void-like io where gtk+-3.0 reports the /usr/lib64 symlink but realpath resolves to /usr/lib.
function makeGtkIo(overrides = {}) {
  return makeIo({
    pkgConfigVariable: (_name: string, variable: string) => {
      if (variable === "libdir") return "/usr/lib64";
      if (variable === "pcfiledir") return "/usr/lib64/pkgconfig";
      return "";
    },
    readFile: (p: string) => (p === "/usr/lib64/pkgconfig/gtk+-3.0.pc" ? GTK_PC_SOURCE : ""),
    realpath: (p: string) => (p === "/usr/lib64" ? "/usr/lib" : p),
    ...overrides,
  });
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

describe("rewriteGtkPcLibdir", () => {
  it("rewrites only libdir to the canonical dir and keeps every other field", () => {
    const out = rewriteGtkPcLibdir(GTK_PC_SOURCE, "/usr/lib");
    expect(out).toContain("libdir=/usr/lib");
    expect(out).not.toContain(`libdir=${V}{prefix}/lib64`);
    expect(out).toContain("Requires: gdk-3.0 atk >= 2.35.1 cairo >= 1.14.0");
    expect(out).toContain("Version: 3.24.52");
    expect(out).toContain("gtk_binary_version=3.0.0");
    expect(out).toContain("targets=broadway wayland x11");
  });

  it("returns the source unchanged when there is no libdir assignment", () => {
    const src = "prefix=/usr\nName: GTK+\nVersion: 3.24.52\n";
    expect(rewriteGtkPcLibdir(src, "/usr/lib")).toBe(src);
  });
});

describe("createAppIndicatorShimEnv gtk+-3.0 canonicalization", () => {
  it("writes a canonicalized gtk+-3.0.pc when libdir is a symlink to the real dir", () => {
    const { io, calls } = makeGtkIo();
    const env = createAppIndicatorShimEnv({ platform: "linux", io, cacheDir: "/tmp/shim", env: {} });
    expect(env).toEqual({ PKG_CONFIG_PATH: "/tmp/shim" });
    expect(calls.writeGtkPc).toHaveLength(1);
    expect(calls.writeGtkPc[0].dir).toBe("/tmp/shim");
    expect(calls.writeGtkPc[0].content).toContain("libdir=/usr/lib");
    expect(calls.writeGtkPc[0].content).toContain("Requires: gdk-3.0");
  });

  it("emits the gtk shim even when the appindicator probe already resolves cleanly", () => {
    const { io, calls } = makeGtkIo({ pkgConfigLibs: () => "-L/usr/lib" });
    const env = createAppIndicatorShimEnv({ platform: "linux", io, cacheDir: "/tmp/shim", env: {} });
    expect(env).toEqual({ PKG_CONFIG_PATH: "/tmp/shim" });
    expect(calls.writeShim).toHaveLength(0);
    expect(calls.writeGtkPc).toHaveLength(1);
  });

  it("is a no-op for gtk when libdir is already canonical", () => {
    const { io, calls } = makeGtkIo({
      pkgConfigLibs: () => "-L/usr/lib",
      realpath: (p: string) => p,
    });
    expect(createAppIndicatorShimEnv({ platform: "linux", io, cacheDir: "/tmp/shim", env: {} })).toEqual({});
    expect(calls.writeGtkPc).toHaveLength(0);
  });

  it("is a no-op for gtk when gtk+-3.0 is not installed", () => {
    const { io, calls } = makeIo({ pkgConfigLibs: () => "-L/usr/lib" });
    expect(createAppIndicatorShimEnv({ platform: "linux", io, cacheDir: "/tmp/shim", env: {} })).toEqual({});
    expect(calls.writeGtkPc).toHaveLength(0);
  });

  it("preserves an existing PKG_CONFIG_PATH when only the gtk shim is needed", () => {
    const { io } = makeGtkIo({ pkgConfigLibs: () => "-L/usr/lib" });
    const env = createAppIndicatorShimEnv({
      platform: "linux",
      io,
      cacheDir: "/tmp/shim",
      env: { PKG_CONFIG_PATH: "/existing" },
    });
    expect(env.PKG_CONFIG_PATH).toBe(`/tmp/shim${path.delimiter}/existing`);
  });
});
