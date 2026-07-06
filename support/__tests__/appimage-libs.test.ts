import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// support/appimage-libs.cjs runs under plain `node` during release packaging, so load it as CJS.
const require = createRequire(import.meta.url);
const { isHostProvidedGraphicsLib, stripBundledGraphicsLibs } = require("../appimage-libs.cjs");

describe("isHostProvidedGraphicsLib", () => {
  it("flags the driver-coupled graphics/display libs that must come from the host", () => {
    for (const name of [
      "libEGL.so",
      "libEGL.so.1",
      "libEGL.so.1.0.0",
      "libGL.so.1",
      "libGLX.so.0",
      "libGLdispatch.so.0",
      "libOpenGL.so.0",
      "libglapi.so.0",
      "libgbm.so.1",
      "libdrm.so.2",
      "libwayland-client.so.0",
      "libwayland-egl.so.1",
      "libwayland-cursor.so.0",
      "libwayland-server.so.0",
    ]) {
      expect(isHostProvidedGraphicsLib(name), name).toBe(true);
    }
  });

  it("keeps the app's own GTK/WebKit/glib/runtime libraries (incl. look-alikes)", () => {
    for (const name of [
      "libwebkit2gtk-4.1.so.0",
      "libgtk-3.so.0",
      "libgdk-3.so.0",
      "libglib-2.0.so.0", // must not be caught by the libGL rule
      "libgio-2.0.so.0",
      "libgobject-2.0.so.0",
      "libsoup-3.0.so.0",
      "libssl.so.3",
      "libc.so.6",
      "libgstreamer-1.0.so.0",
      "libGLESv2.so.2", // GLES is not on the strip list
      "libharfbuzz.so.0",
    ]) {
      expect(isHostProvidedGraphicsLib(name), name).toBe(false);
    }
  });
});

describe("stripBundledGraphicsLibs", () => {
  let root: string;
  let appDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cd-appdir-"));
    appDir = path.join(root, "squashfs-root");
    fs.mkdirSync(path.join(appDir, "usr", "lib", "x86_64-linux-gnu"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const write = (rel: string) => {
    const target = path.join(appDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "x");
  };

  it("removes only the host-provided graphics libs, recursively, and reports them", () => {
    const removedPaths = [
      "usr/lib/libEGL.so.1",
      "usr/lib/libgbm.so.1",
      "usr/lib/libwayland-client.so.0",
      "usr/lib/x86_64-linux-gnu/libGL.so.1",
    ];
    const keptPaths = ["usr/lib/libwebkit2gtk-4.1.so.0", "usr/lib/libgtk-3.so.0", "usr/lib/libglib-2.0.so.0"];
    for (const rel of [...removedPaths, ...keptPaths]) {
      write(rel);
    }

    const removed = stripBundledGraphicsLibs(appDir);

    expect(removed.slice().sort()).toEqual(removedPaths.slice().sort());
    for (const rel of removedPaths) {
      expect(fs.existsSync(path.join(appDir, rel)), rel).toBe(false);
    }
    for (const rel of keptPaths) {
      expect(fs.existsSync(path.join(appDir, rel)), rel).toBe(true);
    }
  });

  it("also removes versioned symlinks that point at a stripped lib", () => {
    write("usr/lib/libEGL.so.1.1.0");
    fs.symlinkSync("libEGL.so.1.1.0", path.join(appDir, "usr", "lib", "libEGL.so.1"));
    fs.symlinkSync("libEGL.so.1", path.join(appDir, "usr", "lib", "libEGL.so"));

    const removed = stripBundledGraphicsLibs(appDir);

    expect(removed.slice().sort()).toEqual(["usr/lib/libEGL.so", "usr/lib/libEGL.so.1", "usr/lib/libEGL.so.1.1.0"]);
    expect(fs.readdirSync(path.join(appDir, "usr", "lib")).filter((n) => n.startsWith("libEGL"))).toEqual([]);
  });

  it("returns an empty list when there is nothing to strip", () => {
    write("usr/lib/libgtk-3.so.0");
    expect(stripBundledGraphicsLibs(appDir)).toEqual([]);
  });
});
