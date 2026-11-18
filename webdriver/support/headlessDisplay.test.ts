// The WebDriver app runs on a private headless sway so its window never reaches the developer's desktop, and it
// renders on a render node that is not NVIDIA's (a desktop here loses that card under sustained load). These are the
// decisions that make that true; starting and stopping the compositor is verified live.
import { describe, expect, it } from "vitest";

import {
  appEnv,
  findSocket,
  headlessWanted,
  pickRenderNode,
  staleDisplays,
  swayConfig,
  swayEnv,
} from "./headlessDisplay.js";

const MESA = "/usr/share/glvnd/egl_vendor.d/50_mesa.json";

describe("headlessWanted", () => {
  it("is on by default on Linux", () => {
    expect(headlessWanted({}, "linux")).toBe(true);
  });

  it("is off when the developer asks to watch the window", () => {
    expect(headlessWanted({ CONTAINER_DESKTOP_E2E_HEADLESS: "0" }, "linux")).toBe(false);
  });

  it("never applies off Linux", () => {
    expect(headlessWanted({}, "darwin")).toBe(false);
    expect(headlessWanted({}, "win32")).toBe(false);
  });
});

describe("pickRenderNode", () => {
  it("skips the NVIDIA node for the first other one", () => {
    const nodes = [
      { name: "renderD128", vendor: "0x10de" },
      { name: "renderD129", vendor: "0x8086" },
    ];
    expect(pickRenderNode(nodes)).toBe("/dev/dri/renderD129");
  });

  it("keeps the order it is given", () => {
    const nodes = [
      { name: "renderD128", vendor: "0x8086" },
      { name: "renderD129", vendor: "0x1002" },
    ];
    expect(pickRenderNode(nodes)).toBe("/dev/dri/renderD128");
  });

  it("answers null when only NVIDIA is there, so rendering goes to software", () => {
    expect(pickRenderNode([{ name: "renderD128", vendor: "0x10de" }])).toBeNull();
    expect(pickRenderNode([])).toBeNull();
  });
});

describe("swayConfig", () => {
  it("makes one output, no borders, no Xwayland, and floating windows so a requested size holds", () => {
    expect(swayConfig({ width: 1280, height: 800, refreshHz: 30 })).toBe(
      [
        "output HEADLESS-1 mode 1280x800@30Hz",
        "default_border none",
        "xwayland disable",
        'for_window [app_id=".*"] floating enable',
        "",
      ].join("\n"),
    );
  });
});

describe("findSocket", () => {
  it("answers the one Wayland socket and ignores its lock and the IPC socket", () => {
    expect(findSocket(["wayland-1.lock", "sway.conf", "sway-ipc.sock", "wayland-1"])).toBe("wayland-1");
  });

  it("answers null until the socket exists", () => {
    expect(findSocket(["sway.conf", "owner.pid"])).toBeNull();
  });

  it("refuses two sockets, since it cannot tell which is the compositor's", () => {
    expect(() => findSocket(["wayland-1", "wayland-2"])).toThrow(/two Wayland sockets/);
  });
});

describe("swayEnv", () => {
  const base = { HOME: "/home/u", WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":0", XDG_RUNTIME_DIR: "/run/user/1000" };

  it("runs headless on the chosen node, in the private dir, away from the desktop's displays", () => {
    const env = swayEnv(base, { dir: "/tmp/cd", renderNode: "/dev/dri/renderD128", mesaVendorFile: MESA });
    expect(env).toEqual({
      HOME: "/home/u",
      XDG_RUNTIME_DIR: "/tmp/cd",
      SWAYSOCK: "/tmp/cd/sway-ipc.sock",
      WLR_BACKENDS: "headless",
      WLR_HEADLESS_OUTPUTS: "1",
      WLR_RENDER_DRM_DEVICE: "/dev/dri/renderD128",
      __EGL_VENDOR_LIBRARY_FILENAMES: MESA,
    });
  });

  it("renders with pixman when there is no node to use", () => {
    const env = swayEnv(base, { dir: "/tmp/cd", renderNode: null, mesaVendorFile: MESA });
    expect(env.WLR_RENDERER).toBe("pixman");
    expect(env.WLR_RENDER_DRM_DEVICE).toBeUndefined();
  });

  it("leaves the EGL vendor alone when mesa's is not installed", () => {
    const env = swayEnv(base, { dir: "/tmp/cd", renderNode: "/dev/dri/renderD128", mesaVendorFile: null });
    expect(env).not.toHaveProperty("__EGL_VENDOR_LIBRARY_FILENAMES");
  });
});

describe("appEnv", () => {
  const base = { HOME: "/home/u", DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0", XDG_RUNTIME_DIR: "/run/user/1000" };

  it("points the app at the private socket only, and keeps the real runtime dir the engine sockets live in", () => {
    const env = appEnv(base, {
      socket: "/tmp/cd/wayland-1",
      renderNode: "/dev/dri/renderD128",
      mesaVendorFile: MESA,
    });
    expect(env).toEqual({
      HOME: "/home/u",
      XDG_RUNTIME_DIR: "/run/user/1000",
      WAYLAND_DISPLAY: "/tmp/cd/wayland-1",
      GDK_BACKEND: "wayland",
      __EGL_VENDOR_LIBRARY_FILENAMES: MESA,
      WEBKIT_WEB_RENDER_DEVICE_FILE: "/dev/dri/renderD128",
    });
  });

  it("renders in software when there is no node to use", () => {
    const env = appEnv(base, { socket: "/tmp/cd/wayland-1", renderNode: null, mesaVendorFile: MESA });
    expect(env).toMatchObject({
      LIBGL_ALWAYS_SOFTWARE: "1",
      WEBKIT_SKIA_ENABLE_CPU_RENDERING: "1",
      WEBKIT_DMABUF_RENDERER_FORCE_SHM: "1",
      WEBKIT_DMABUF_RENDERER_DISABLE_GBM: "1",
      WEBKIT_WEBGL_DISABLE_GBM: "1",
    });
    expect(env).not.toHaveProperty("WEBKIT_WEB_RENDER_DEVICE_FILE");
  });

  it("does not change the environment it was given", () => {
    appEnv(base, { socket: "/tmp/cd/wayland-1", renderNode: null, mesaVendorFile: null });
    expect(base.DISPLAY).toBe(":0");
    expect(base.WAYLAND_DISPLAY).toBe("wayland-0");
  });
});

describe("staleDisplays", () => {
  it("answers only the displays whose run is gone, never a run still going", () => {
    const displays = [
      { dir: "/tmp/container-desktop-e2e-a", ownerPid: 10 },
      { dir: "/tmp/container-desktop-e2e-b", ownerPid: 20 },
    ];
    expect(staleDisplays(displays, (pid) => pid === 20)).toEqual([displays[0]]);
  });

  it("treats a display with no owner recorded as stale", () => {
    const displays = [{ dir: "/tmp/container-desktop-e2e-c", ownerPid: null }];
    expect(staleDisplays(displays, () => true)).toEqual(displays);
  });
});
