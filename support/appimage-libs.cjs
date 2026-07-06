const fs = require("node:fs");
const path = require("node:path");

// Libraries an AppImage must NOT bundle: they are tightly coupled to the host's kernel/GPU
// driver stack and must be provided by the running system. When an AppImage ships older copies,
// the host's Mesa/EGL loads mismatched symbols and aborts at startup with
// "Could not create default EGL display: EGL_BAD_PARAMETER" on newer/rolling distros.
// Tauri builds AppImages with linuxdeploy, whose AppRun prepends the bundled libs via
// LD_LIBRARY_PATH — so these slip in through the GTK/WebKit dependency chain even though the
// upstream AppImage excludelist already covers most of them. This is the excludelist graphics
// subset plus the full libwayland-* family, matching the reporter's verified workaround.
const HOST_PROVIDED_GRAPHICS_LIBS = [
  /^libEGL\.so(\.|$)/,
  /^libGL\.so(\.|$)/,
  /^libGLX\.so(\.|$)/,
  /^libGLdispatch\.so(\.|$)/,
  /^libOpenGL\.so(\.|$)/,
  /^libglapi\.so(\.|$)/,
  /^libgbm\.so(\.|$)/,
  /^libdrm\.so(\.|$)/,
  /^libwayland-client\.so(\.|$)/,
  /^libwayland-egl\.so(\.|$)/,
  /^libwayland-cursor\.so(\.|$)/,
  /^libwayland-server\.so(\.|$)/,
];

// Where linuxdeploy stages bundled shared objects inside the AppDir.
const LIBRARY_ROOTS = ["usr/lib", "usr/lib64", "lib", "lib64"];

function isHostProvidedGraphicsLib(fileName) {
  return HOST_PROVIDED_GRAPHICS_LIBS.some((pattern) => pattern.test(fileName));
}

function collectLibraryFiles(dir, results) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectLibraryFiles(entryPath, results);
    } else {
      // Real .so files and their versioned symlinks both need to go.
      results.push(entryPath);
    }
  }
}

// Deletes the host-provided graphics/display libraries from an extracted AppDir (squashfs-root),
// so the app falls back to the host's copies. Returns the removed paths (relative to appDir, posix).
function stripBundledGraphicsLibs(appDir) {
  const removed = [];
  for (const root of LIBRARY_ROOTS) {
    const libDir = path.join(appDir, root);
    if (!fs.existsSync(libDir)) {
      continue;
    }
    const files = [];
    collectLibraryFiles(libDir, files);
    for (const filePath of files) {
      if (isHostProvidedGraphicsLib(path.basename(filePath))) {
        fs.rmSync(filePath, { force: true });
        removed.push(path.relative(appDir, filePath).split(path.sep).join("/"));
      }
    }
  }
  return removed;
}

module.exports = {
  HOST_PROVIDED_GRAPHICS_LIBS,
  isHostProvidedGraphicsLib,
  stripBundledGraphicsLibs,
};
