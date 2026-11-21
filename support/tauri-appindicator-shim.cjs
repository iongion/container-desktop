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
//
// It also fixes a second, independent AppImage failure on the same symlinked distros: Tauri's
// linuxdeploy-plugin-gtk.sh derives the GTK immodules.cache path from `pkg-config --variable=libdir
// gtk+-3.0` (e.g. /usr/lib64) but canonicalizes the copy target with realpath (/usr/lib). The mismatch
// makes it write the cache into an AppDir subdir that was never created, so linuxdeploy exits 1. When
// gtk+-3.0's libdir is a symlink, we emit a copy of its real .pc with only libdir rewritten to the
// canonical dir, so the plugin's paths line up. All other fields/Requires are preserved.
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const SO_NAME = "libayatana-appindicator3.so.1";
const PC_NAME = "ayatana-appindicator3-0.1";
const GTK_PC_NAME = "gtk+-3.0";
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

// Rewrite only the libdir assignment in a gtk+-3.0.pc to the canonical directory, leaving every other
// variable, Requires and field intact so the linuxdeploy gtk plugin still resolves all of GTK's deps.
function rewriteGtkPcLibdir(source, canonicalLibdir) {
  return source.replace(/^libdir=.*$/m, `libdir=${canonicalLibdir}`);
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
  pkgConfigVariable: (name, variable) => {
    try {
      return childProcess.execFileSync("pkg-config", [`--variable=${variable}`, name], { encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  },
  readFile: (p) => fs.readFileSync(p, "utf8"),
  exists: (p) => fs.existsSync(p),
  realpath: (p) => fs.realpathSync(p),
  writeShim: (dir, content) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${PC_NAME}.pc`), content);
    return dir;
  },
  writeGtkPc: (dir, content) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${GTK_PC_NAME}.pc`), content);
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

// Emit a canonicalized gtk+-3.0.pc when its libdir is a symlink (Void: /usr/lib64 -> /usr/lib). Returns
// true when a shim was written. Best-effort: any missing piece (no gtk, no libdir, unreadable .pc) is a
// no-op so non-symlinked distros are untouched.
function canonicalizeGtkPc(io, cacheDir) {
  if (typeof io.pkgConfigVariable !== "function") {
    return false;
  }
  const libdir = io.pkgConfigVariable(GTK_PC_NAME, "libdir");
  if (!libdir) {
    return false;
  }
  let canonical;
  try {
    canonical = io.realpath(libdir);
  } catch {
    return false;
  }
  if (!canonical || canonical === libdir) {
    return false;
  }
  const pcfiledir = io.pkgConfigVariable(GTK_PC_NAME, "pcfiledir");
  if (!pcfiledir) {
    return false;
  }
  let source;
  try {
    source = io.readFile(path.join(pcfiledir, `${GTK_PC_NAME}.pc`));
  } catch {
    return false;
  }
  const rewritten = rewriteGtkPcLibdir(source, canonical);
  if (!rewritten || rewritten === source) {
    return false;
  }
  io.writeGtkPc(cacheDir, rewritten);
  return true;
}

// Returns { PKG_CONFIG_PATH } to prepend the shim dir, or {} when no shim is needed/possible. Both the
// appindicator probe fix and the gtk plugin libdir fix share the same dir; either one triggers the patch.
function createAppIndicatorShimEnv(options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== "linux") {
    return {};
  }
  try {
    const io = { ...defaultIo, ...(options.io || {}) };
    const env = options.env || process.env;
    const cacheDir = options.cacheDir || defaultCacheDir();
    let wroteShim = false;

    const libPath = locateLibrary(io);
    if (libPath) {
      // Resolve symlinks (Void: /usr/lib64 -> /usr/lib) so the shim points at the canonical directory.
      const libdir = io.realpath(path.dirname(libPath));
      // If pkg-config already yields a single valid -L at the real library, the CLI works as-is: no shim.
      const single = parseSingleLibDir(io.pkgConfigLibs(PC_NAME));
      if (!(single && io.exists(path.join(single, SO_NAME)))) {
        io.writeShim(cacheDir, renderPcFile(libdir));
        wroteShim = true;
      }
    }

    if (canonicalizeGtkPc(io, cacheDir)) {
      wroteShim = true;
    }

    if (!wroteShim) {
      return {};
    }
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
  rewriteGtkPcLibdir,
};
