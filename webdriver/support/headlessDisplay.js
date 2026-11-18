// The WebDriver app's own display on Linux: a headless sway nobody looks at, so the window never lands on the
// developer's desktop (nor catches their keystrokes), rendering on a node that is not NVIDIA's. The method is
// pagecast's (scripts/electron-dev.mjs, src-go/internal/session/sway.go in iongion/pagecast).
//
// The app keeps the real XDG_RUNTIME_DIR, because the rootless Podman/Docker sockets live there; only its display
// changes, to the absolute path of the private socket. DISPLAY goes, so GTK cannot fall back onto the desktop's X.
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const HEADLESS_OPT_OUT = "CONTAINER_DESKTOP_E2E_HEADLESS";

const NVIDIA_VENDOR = "0x10de";
const MESA_VENDOR_FILE = "/usr/share/glvnd/egl_vendor.d/50_mesa.json";
const DRM_ROOT = "/sys/class/drm";
const DIR_PREFIX = "container-desktop-e2e-";
const WAYLAND_SOCKET = /^wayland-\d+$/;
const STOP_GRACE_MS = 2000;
const POLL_MS = 50;
const SETPRIV = "/usr/bin/setpriv";

// No GPU at all: llvmpipe for GL, Skia on the CPU, and buffers shared through memory rather than GBM.
const SOFTWARE_RENDERING = {
  LIBGL_ALWAYS_SOFTWARE: "1",
  WEBKIT_SKIA_ENABLE_CPU_RENDERING: "1",
  WEBKIT_DMABUF_RENDERER_FORCE_SHM: "1",
  WEBKIT_DMABUF_RENDERER_DISABLE_GBM: "1",
  WEBKIT_WEBGL_DISABLE_GBM: "1",
};

const MISSING_SWAY =
  "sway is not installed. Linux WebDriver runs put the app on a private headless sway so its window never reaches " +
  "your desktop. Install it (`sudo apt install sway`, or `bash support/provision-deps.sh`), or set " +
  `${HEADLESS_OPT_OUT}=0 to run the window on your desktop.`;

export function headlessWanted(env, platform) {
  return platform === "linux" && env[HEADLESS_OPT_OUT] !== "0";
}

// The first render node that is not NVIDIA's, or null for software rendering.
export function pickRenderNode(nodes) {
  const node = nodes.find(({ vendor }) => vendor !== NVIDIA_VENDOR);
  return node ? `/dev/dri/${node.name}` : null;
}

// Floating, because a tiled window fills the output and ignores the size a spec asks for.
export function swayConfig({ width, height, refreshHz }) {
  return [
    `output HEADLESS-1 mode ${width}x${height}@${refreshHz}Hz`,
    "default_border none",
    "xwayland disable",
    'for_window [app_id=".*"] floating enable',
    "",
  ].join("\n");
}

// sway names its socket itself (wl_display_add_socket_auto ignores WAYLAND_DISPLAY), so it is found by watching
// the private directory.
export function findSocket(names) {
  const sockets = names.filter((name) => WAYLAND_SOCKET.test(name));
  if (sockets.length > 1) {
    throw new Error(`two Wayland sockets appeared (${sockets.join(", ")}); cannot tell which one is the compositor's`);
  }
  return sockets[0] ?? null;
}

function withoutDesktopDisplays(base) {
  const { DISPLAY: _x11, WAYLAND_DISPLAY: _wayland, ...rest } = base;
  return rest;
}

function eglVendor(mesaVendorFile) {
  // glvnd then never loads NVIDIA's EGL, and its Wayland and GBM platforms hang off that library.
  return mesaVendorFile ? { __EGL_VENDOR_LIBRARY_FILENAMES: mesaVendorFile } : {};
}

export function swayEnv(base, { dir, renderNode, mesaVendorFile }) {
  return {
    ...withoutDesktopDisplays(base),
    XDG_RUNTIME_DIR: dir,
    SWAYSOCK: path.join(dir, "sway-ipc.sock"),
    WLR_BACKENDS: "headless",
    WLR_HEADLESS_OUTPUTS: "1",
    ...(renderNode ? { WLR_RENDER_DRM_DEVICE: renderNode } : { WLR_RENDERER: "pixman" }),
    ...eglVendor(mesaVendorFile),
  };
}

export function appEnv(base, { socket, renderNode, mesaVendorFile }) {
  return {
    ...withoutDesktopDisplays(base),
    WAYLAND_DISPLAY: socket,
    GDK_BACKEND: "wayland",
    ...eglVendor(mesaVendorFile),
    ...(renderNode ? { WEBKIT_WEB_RENDER_DEVICE_FILE: renderNode } : SOFTWARE_RENDERING),
  };
}

// A display whose run has ended. A run that is still going is never touched, whichever worktree it belongs to.
export function staleDisplays(displays, isAlive) {
  return displays.filter(({ ownerPid }) => !ownerPid || !isAlive(ownerPid));
}

function renderNodes() {
  let names;
  try {
    names = readdirSync(DRM_ROOT).filter((name) => /^renderD\d+$/.test(name));
  } catch {
    return [];
  }
  return names
    .sort((a, b) => Number(a.slice(7)) - Number(b.slice(7)))
    .map((name) => ({ name, vendor: readFileSync(path.join(DRM_ROOT, name, "device", "vendor"), "utf8").trim() }));
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// The kernel ends the child when this process dies, however it dies. An interrupted wdio SIGKILLs its worker, which
// runs no exit handler, so nothing in JavaScript could do this. pagecast's Pdeathsig (src-go/internal/spawn/linux.go).
export function diesWithParent(command, args) {
  return existsSync(SETPRIV) ? [SETPRIV, ["--pdeathsig", "KILL", command, ...args]] : [command, args];
}

export function signalGroup(pid, signal) {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch {
    // already gone
  }
}

function readPid(file) {
  try {
    return Number(readFileSync(file, "utf8").trim()) || null;
  } catch {
    return null;
  }
}

// A sway pid read from a file is only signalled while it is still that sway; a recycled pid is someone else's.
function isOurSway(pid, dir) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(dir);
  } catch {
    return false;
  }
}

// Ends the displays of runs that died without tearing down (a killed wdio, a crashed worker).
export function reapStaleDisplays(tmp = os.tmpdir()) {
  const displays = readdirSync(tmp)
    .filter((name) => name.startsWith(DIR_PREFIX))
    .map((name) => ({ dir: path.join(tmp, name), ownerPid: Number(name.slice(DIR_PREFIX.length).split("-")[0]) || null }));
  for (const { dir } of staleDisplays(displays, isAlive)) {
    const swayPid = readPid(path.join(dir, "sway.pid"));
    if (swayPid && isOurSway(swayPid, dir)) signalGroup(swayPid, "SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
}

function logTail(file) {
  try {
    return readFileSync(file, "utf8").trim().split("\n").slice(-10).join("\n");
  } catch {
    return "";
  }
}

// Asked up front: under setpriv a missing sway is setpriv failing to exec, not a spawn error, and says nothing useful.
function swayInstalled() {
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .some((directory) => directory && existsSync(path.join(directory, "sway")));
}

// Its own process group, so teardown takes everything sway started with it.
function launchSway({ dir, config, log, renderNode, mesaVendorFile }) {
  const logFd = openSync(log, "a");
  const sway = spawn(...diesWithParent("sway", ["-c", config]), {
    env: swayEnv(process.env, { dir, renderNode, mesaVendorFile }),
    detached: true,
    stdio: ["ignore", "ignore", logFd],
  });
  closeSync(logFd);
  sway.unref();
  if (sway.pid) writeFileSync(path.join(dir, "sway.pid"), String(sway.pid));
  return sway;
}

// Polls the private directory for the socket sway names itself; answers its file name, or why there is none.
async function awaitSocket(sway, dir, timeoutMs) {
  let spawnError = null;
  sway.once("error", (error) => {
    spawnError = error;
  });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (spawnError) return { error: `sway did not start: ${spawnError.message}` };
    if (sway.exitCode !== null || sway.signalCode !== null) {
      return { error: `sway exited (${sway.exitCode ?? sway.signalCode}) before opening its Wayland socket` };
    }
    try {
      const socket = findSocket(readdirSync(dir));
      if (socket) return { socket };
    } catch (error) {
      return { error: error.message };
    }
    if (Date.now() > deadline) return { error: `sway opened no Wayland socket within ${timeoutMs / 1000}s` };
    await delay(POLL_MS);
  }
}

// Starts a private headless sway and answers its socket, the environment the app must run with, and the teardown.
export async function startHeadlessDisplay({ width = 1280, height = 800, refreshHz = 30, timeoutMs = 10000 } = {}) {
  if (!swayInstalled()) throw new Error(MISSING_SWAY);
  const renderNode = pickRenderNode(renderNodes());
  const mesaVendorFile = existsSync(MESA_VENDOR_FILE) ? MESA_VENDOR_FILE : null;
  // The owner's pid is in the name, so a later run can tell a dead run's display from a live one without a race.
  const dir = mkdtempSync(path.join(os.tmpdir(), `${DIR_PREFIX}${process.pid}-`));
  const config = path.join(dir, "sway.conf");
  const log = path.join(dir, "sway.log");
  writeFileSync(config, swayConfig({ width, height, refreshHz }), { mode: 0o600 });
  const sway = launchSway({ dir, config, log, renderNode, mesaVendorFile });
  const exited = () => sway.exitCode !== null || sway.signalCode !== null;
  const stopNow = () => {
    signalGroup(sway.pid, "SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  };

  const { socket, error } = await awaitSocket(sway, dir, timeoutMs);
  if (error) {
    const tail = logTail(log);
    stopNow();
    throw new Error(tail ? `${error}\n${tail}` : error);
  }

  const socketPath = path.join(dir, socket);
  return {
    socket: socketPath,
    renderNode,
    envFor: (base) => appEnv(base, { socket: socketPath, renderNode, mesaVendorFile }),
    async stop() {
      signalGroup(sway.pid, "SIGTERM");
      const stopDeadline = Date.now() + STOP_GRACE_MS;
      while (!exited() && Date.now() < stopDeadline) await delay(POLL_MS);
      stopNow();
    },
  };
}
