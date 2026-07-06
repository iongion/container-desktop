import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// The website's download page and the packager both read support/build-matrix.cjs.
// These tests fail the moment the rendered download links stop matching the set of
// assets CI actually publishes — so the page can never silently drift again.
const require = createRequire(import.meta.url);
const matrix = require("../../support/build-matrix.cjs");

const VERSION = "9.9.9";
const model = matrix.downloadModel(VERSION, { microsoftStore: "https://store.example/app" });

function linkedAssetNames() {
  const names = new Set<string>();
  const collect = (url?: string) => {
    if (url?.includes(`/releases/download/${VERSION}/`)) names.add(url.split("/").pop() as string);
  };
  for (const os of model.os) {
    collect(os.file);
    for (const option of os.options ?? []) collect(option.file);
    for (const link of os.links ?? []) collect(link.file);
  }
  return [...names].sort();
}

describe("website download model", () => {
  it("links exactly the public release assets the matrix declares", () => {
    expect(linkedAssetNames()).toEqual(matrix.publicAssetNames(VERSION));
  });

  it("surfaces every Linux format on both arches (incl. AppImage + pacman)", () => {
    const linux = model.os.find((os: { slug: string }) => os.slug === "linux");
    expect(new Set(linux.options.map((o: { format: string }) => o.format))).toEqual(
      new Set(["deb", "rpm", "tar.gz", "AppImage", "pacman"]),
    );
    // 5 formats × 2 arches.
    expect(linux.options).toHaveLength(10);
    // index.njk marks options[0] as the primary download; keep it deterministic.
    expect(linux.options[0].id).toBe("linux-deb-x64");
  });

  it("gives Windows a per-arch dropdown (installer + zip, both arches) with the Store as the fixed primary", () => {
    const win = model.os.find((os: { slug: string }) => os.slug === "windows");
    // Primary button stays the external Microsoft Store; the menu must NOT hijack it (os-detect.js
    // only rewrites the button from a data-primary option, so externalPrimary suppresses that mark).
    expect(win.menu).toBe(true);
    expect(win.externalPrimary).toBe(true);
    expect(win.file).toBe("https://store.example/app");
    expect(win.buttonLabel).toBe("Microsoft Store");
    // Two rows — Installer .exe then Portable .zip — each on Intel + Arm.
    expect(win.rows.map((r: { badge: string }) => r.badge)).toEqual([".exe", ".zip"]);
    for (const row of win.rows) {
      expect(row.options.map((o: { arch: string }) => o.arch)).toEqual(["x64", "arm64"]);
    }
    // The signed Store Web Installer stub is architecture-neutral — one hand-uploaded file (at its own
    // pinned version) serves BOTH arches, so the Intel and Arm columns link to the same download.
    const base = `https://github.com/iongion/container-desktop/releases/download/${matrix.WINDOWS_INSTALLER_VERSION}`;
    expect(win.rows[0].options.map((o: { file: string }) => o.file)).toEqual([
      `${base}/container-desktop-installer.exe`,
      `${base}/container-desktop-installer.exe`,
    ]);
  });

  it("never offers the unpublished Windows artifacts (Store packages / unsigned .exe)", () => {
    const published = matrix.publicAssetNames(VERSION);
    expect(published.some((name: string) => name.endsWith(".appx"))).toBe(false);
    expect(published.some((name: string) => name.endsWith(".msix"))).toBe(false);
    expect(published.some((name: string) => name.endsWith(".exe"))).toBe(false);
  });

  it("keeps legacy Electron builder targets compatible with public formats", () => {
    for (const platform of ["linux", "mac", "win"] as const) {
      const targets = matrix.electronBuilderTargets(platform);
      const publicTargets = matrix.PLATFORMS[platform].formats
        .filter((f: { public?: boolean }) => f.public !== false)
        .map((f: { target: string }) => f.target);
      // Every publishable format is something the builder is told to emit.
      for (const target of publicTargets) expect(targets).toContain(target);
    }
    expect(matrix.electronBuilderTargets("linux")).toEqual(["deb", "rpm", "tar.gz", "AppImage", "pacman"]);
  });

  it("uses the per-format arch tokens published artifacts keep for parity", () => {
    // Regression guard for the tokens verified against real release assets.
    expect(linkedAssetNames()).toContain(`container-desktop-linux-amd64-${VERSION}.deb`);
    expect(linkedAssetNames()).toContain(`container-desktop-linux-aarch64-${VERSION}.rpm`);
    expect(linkedAssetNames()).toContain(`container-desktop-linux-x86_64-${VERSION}.AppImage`);
    expect(linkedAssetNames()).toContain(`container-desktop-linux-aarch64-${VERSION}.pacman`);
  });
});
