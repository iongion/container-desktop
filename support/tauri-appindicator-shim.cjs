#!/usr/bin/env node
// AppImage bundling on Linux needs the Tauri CLI to locate libayatana-appindicator3.so.1 so it can
// copy it into the AppImage. The CLI detects it with `pkg-config --libs-only-L ayatana-appindicator3-0.1`
// and then naively strips only the first two characters of the whole stdout. On rolling distros such as
// Void the distro .pc has `Requires: ... gtk+-3.0`, so pkg-config (with PKG_CONFIG_ALLOW_SYSTEM_LIBS=1)
// emits SEVERAL -L flags; the CLI turns that into a bogus path like
// "/usr/lib64 -L/usr/lib -L/usr/lib64/libayatana-appindicator3.so.1" and bundling fails.
//
// This helper writes a minimal, single-`-L` .pc (no `Requires:`) into a git-ignored cache dir and returns
// a PKG_CONFIG_PATH patch that prepends it, so the CLI sees exactly one clean library directory. It only
// affects the CLI's file-copy detection: libappindicator-sys has no build.rs and never calls pkg-config,
// so Rust compilation and every other crate's .pc lookups are untouched. Best-effort: any failure returns
// {} and the build proceeds exactly as before.
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const SO_NAME = "libayatana-appindicator3.so.1";
const PC_NAME = "ayatana-appindicator3-0.1";
const CANDIDATE_DIRS = ["/usr/lib", "/usr/lib64", "/usr/local/lib", "/lib"];

// Parse one library path out of `ldconfig -p` output. Each line looks like:
//   libayatana-appindicator3.so.1 (libc6,x86-64) => /usr/lib/libayatana-appindicator3.so.1
function parseLdconfigPath(output, soName) {
  for (const line of (output || "").split("\n")) {
    const arrow = line.indexOf("=>");
    if (arrow === -1 || !line.slice(0, arrow).includes(soName)) {
      continue;
    }
    const candidate = line.slice(arrow + 2).trim();
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

// The CLI only handles a SINGLE -L flag. Return its directory when stdout is exactly one -L<path>,
// otherwise null (empty output, or the multi--L case that breaks the CLI's parser).
function parseSingleLibDir(output) {
  const tokens = (output || "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length !== 1 || !tokens[0].startsWith("-L")) {
    return null;
  }
  return tokens[0].slice(2);
}

// Minimal .pc: one -L pointing at the real library dir, deliberately NO `Requires:` so pkg-config
// cannot pull in gtk+-3.0's extra -L flags. The CLI only queries --libs-only-L, so Cflags are unneeded.
function renderPcFile(libdir) {
  return [
    "prefix=/usr",
    `libdir=${libdir}`,
    `Name: ${PC_NAME}`,
    "Description: Ayatana Application Indicators (container-desktop AppImage build shim)",
    "Version: 0",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal pkg-config variable, not a JS template
    "Libs: -L${libdir} -layatana-appindicator3",
    "",
  ].join("\n");
}

// Real I/O, injectable so tests stay hermetic (no ldconfig/pkg-config/fs calls under Vitest).
const defaultIo = {
  ldconfig: () => childProcess.execFileSync("ldconfig", ["-p"], { encoding: "utf8" }),
  pkgConfigLibs: (name) => {
    try {
      return childProcess.execFileSync("pkg-config", ["--libs-only-L", name], {
        encoding: "utf8",
        env: { ...process.env, PKG_CONFIG_ALLOW_SYSTEM_LIBS: "1" },
      });
    } catch {
      return "";
    }
  },
  exists: (p) => fs.existsSync(p),
  realpath: (p) => fs.realpathSync(p),
  writeShim: (dir, content) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${PC_NAME}.pc`), content);
    return dir;
  },
};

function defaultCacheDir() {
  return path.join(PROJECT_ROOT, "node_modules", ".cache", "container-desktop", "pkgconfig");
}

function locateLibrary(io) {
  let output = "";
  try {
    output = io.ldconfig();
  } catch {
    output = "";
  }
  const fromLdconfig = parseLdconfigPath(output, SO_NAME);
  if (fromLdconfig && io.exists(fromLdconfig)) {
    return fromLdconfig;
  }
  for (const dir of CANDIDATE_DIRS) {
    const candidate = path.join(dir, SO_NAME);
    if (io.exists(candidate)) {
      return candidate;
    }
  }
  return null;
}

// Returns { PKG_CONFIG_PATH } to prepend the shim, or {} when no shim is needed/possible.
function createAppIndicatorShimEnv(options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== "linux") {
    return {};
  }
  try {
    const io = { ...defaultIo, ...(options.io || {}) };
    const env = options.env || process.env;
    const cacheDir = options.cacheDir || defaultCacheDir();

    const libPath = locateLibrary(io);
    if (!libPath) {
      return {};
    }
    // Resolve symlinks (Void: /usr/lib64 -> /usr/lib) so the shim points at the canonical directory.
    const libdir = io.realpath(path.dirname(libPath));

    // If pkg-config already yields a single valid -L at the real library, the CLI works as-is: no shim.
    const single = parseSingleLibDir(io.pkgConfigLibs(PC_NAME));
    if (single && io.exists(path.join(single, SO_NAME))) {
      return {};
    }

    io.writeShim(cacheDir, renderPcFile(libdir));
    const previous = env.PKG_CONFIG_PATH;
    return { PKG_CONFIG_PATH: previous ? `${cacheDir}${path.delimiter}${previous}` : cacheDir };
  } catch {
    return {};
  }
}

module.exports = {
  createAppIndicatorShimEnv,
  parseLdconfigPath,
  parseSingleLibDir,
  renderPcFile,
};
