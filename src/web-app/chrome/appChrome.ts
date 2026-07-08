// SINGLE SOURCE OF TRUTH for the application window chrome — the brand logo and the window controls.
//
// The same definitions feed BOTH consumers, so a brand/glyph/channel change happens once and never drifts:
//   • the live React header — <AppHeaderLogo> renders LOGO_SVG, <AppHeader> maps WINDOW_CONTROLS;
//   • the static boot splash — vite.config.common.mjs injects BOOT_CHROME_{STYLE,BODY,SCRIPT} into index.html
//     via the EJS context, so the frameless window stays draggable / minimizable / closable even if the React
//     app hangs before mounting its own header (the chrome can't depend on the thing that may have failed).
//
// This module avoids React/runtime app state (plain strings/data, mdi glyph paths inlined) so the Vite
// config can import it at config-load time while still sharing the same i18next labels as the live app.
//
// Boot vs React rendering of the SAME logo markup:
//   • LOGO_SVG carries the app's CSS classes (re-themed per engine by AppHeaderLogo.css once React is up)
//     AND literal `unified`-dark presentation attributes (fill/stroke/stop-color/font-*) as boot defaults.
//     Presentation attributes are the lowest-priority paint source, so app CSS overrides them when loaded,
//     while at boot — before any app CSS — they are what render. One markup, correct in both worlds.

import i18n from "../../i18n";

export interface WindowControl {
  /** IPC channel sent on window.MessageBus — handled by registerAppControlIpc in the main process. */
  action: "window.minimize" | "window.maximize" | "window.close";
  label: string;
  /** @mdi/js glyph path (mdiWindowMinimize / mdiWindowMaximize / mdiWindowClose), inlined to stay dependency-free. */
  mdiPath: string;
}

export const WINDOW_CONTROLS: WindowControl[] = [
  { action: "window.minimize", label: i18n.t("Minimize"), mdiPath: "M20,14H4V10H20" },
  { action: "window.maximize", label: i18n.t("Maximize"), mdiPath: "M4,4H20V20H4V4M6,8V18H18V8H6Z" },
  {
    action: "window.close",
    label: i18n.t("Close"),
    mdiPath:
      "M13.46,12L19,17.54V19H17.54L12,13.46L6.46,19H5V17.54L10.54,12L5,6.46V5H6.46L12,10.54L17.54,5H19V6.46L13.46,12Z",
  },
];

// `unified`-dark brand palette (mirrors tokens.css / AppHeaderLogo.css defaults). Baked into LOGO_SVG as boot
// defaults; AppHeaderLogo.css re-themes per engine when React mounts.
const LOGO_FONT = "Montserrat, 'Helvetica Neue', Arial, sans-serif";
const LOGO_TITLE = i18n.t("Container Desktop");
const LOGO_TAGLINE_UNIFIED = i18n.t("Containers desktop companion");
const LOGO_TAGLINE_PODMAN = i18n.t("Podman desktop companion");
const LOGO_TAGLINE_DOCKER = i18n.t("Docker desktop companion");

export const LOGO_SVG = `<svg class="AppHeaderLogo" viewBox="0 0 940 200" role="img" aria-label="${LOGO_TITLE}" focusable="false" xmlns="http://www.w3.org/2000/svg">
  <title>${LOGO_TITLE}</title>
  <defs>
    <linearGradient id="AppHeaderLogoGrad" x1="0" x2="1" y1="0" y2="0.3">
      <stop class="AppHeaderLogoGradStop0" offset="0.18" stop-color="#ffffff" />
      <stop class="AppHeaderLogoGradStop1" offset="0.52" stop-color="#9fe6d6" />
      <stop class="AppHeaderLogoGradStop2" offset="0.92" stop-color="#76c8e0" />
    </linearGradient>
  </defs>
  <g class="AppHeaderLogoMark" transform="translate(6,28) scale(0.56)">
    <path class="AppHeaderLogoPlate AppHeaderLogoPlate--deep" d="M128,120 L216,152 L128,184 L40,152 Z" fill="#0d9488" stroke="#0d9488" stroke-width="16" stroke-linejoin="round" />
    <path class="AppHeaderLogoPlate AppHeaderLogoPlate--accent" d="M128,94 L198,120 L128,146 L58,120 Z" fill="#14b8a6" stroke="#14b8a6" stroke-width="16" stroke-linejoin="round" />
    <path class="AppHeaderLogoPlate AppHeaderLogoPlate--bright" d="M128,72 L180,92 L128,112 L76,92 Z" fill="#2dd4bf" stroke="#2dd4bf" stroke-width="16" stroke-linejoin="round" />
  </g>
  <text class="AppHeaderLogoTitle" x="178" y="96" font-family="${LOGO_FONT}" font-weight="800" font-size="56" letter-spacing="-1.8" fill="#ffffff">${LOGO_TITLE}</text>
  <text class="AppHeaderLogoTagline AppHeaderLogoTagline--unified" x="180" y="137" font-family="${LOGO_FONT}" font-weight="500" font-size="26" letter-spacing="0.2" fill="#7c98a1">${LOGO_TAGLINE_UNIFIED}</text>
  <text class="AppHeaderLogoTagline AppHeaderLogoTagline--podman" x="180" y="137" font-family="${LOGO_FONT}" font-weight="500" font-size="26" letter-spacing="0.2" fill="#7c98a1">${LOGO_TAGLINE_PODMAN}</text>
  <text class="AppHeaderLogoTagline AppHeaderLogoTagline--docker" x="180" y="137" font-family="${LOGO_FONT}" font-weight="500" font-size="26" letter-spacing="0.2" fill="#7c98a1">${LOGO_TAGLINE_DOCKER}</text>
</svg>`;

const BOOT_CONTROL_BUTTONS = WINDOW_CONTROLS.map((control) => {
  const verb = control.action.split(".")[1]; // minimize | maximize | close
  return `<button class="app-boot-ctl app-boot-${verb}" type="button" title="${control.label}" aria-label="${control.label}" data-window-action="${control.action}"><svg viewBox="0 0 24 24"><path d="${control.mdiPath}" /></svg></button>`;
}).join("\n        ");

// Boot CSS — paints the splash + a faithful copy of the header bar (logo left, controls right) before the
// bundle loads. Colors are the app's default `unified` dark theme (tokens.css --app-bg / --app-chrome) so
// there is no color jump when React swaps in. The logo + control classes are sized/scoped HERE because the
// real AppHeader.css / AppHeaderLogo.css are not loaded yet at boot.
export const BOOT_CHROME_STYLE = `/* boot splash content area (--app-bg unified dark) — the whole splash is a drag handle while booting */
    #app-splash {
      position: fixed; inset: 0; z-index: 2147483646;
      display: flex; align-items: center; justify-content: center;
      background: #171c26;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      -webkit-app-region: drag;
      --wails-draggable: drag;
    }
    #app-splash .app-splash-ring {
      width: 36px; height: 36px; border-radius: 50%;
      border: 3px solid rgba(148, 163, 184, 0.16); border-top-color: #14b8a6;
      animation: app-splash-spin 0.8s linear infinite;
    }
    @keyframes app-splash-spin { to { transform: rotate(360deg); } }

    /* boot header bar — mirrors <AppHeader>: 50px tall, --app-chrome background, drag region */
    #app-boot-header {
      position: fixed; top: 0; left: 0; right: 0; height: 50px; z-index: 2147483647;
      display: flex; align-items: center;
      background: #11151d;
      -webkit-app-region: drag;
      --wails-draggable: drag;
    }
    #app-boot-brand {
      display: flex; align-items: center; height: 100%;
      width: 250px; padding-left: 6px; box-sizing: border-box;
    }
    #app-boot-brand .AppHeaderLogo { display: block; width: 100%; height: auto; overflow: visible; }
    /* AppHeaderLogo.css is not loaded at boot, so scope the engine tagline to unified here (the SVG ships all three) */
    #app-boot-brand .AppHeaderLogoTagline { display: none; }
    #app-boot-brand .AppHeaderLogoTagline--unified { display: inline; }

    /* window controls — same set <AppHeader> draws on Linux/Windows; macOS uses native traffic lights, so the
       custom set is hidden and the brand recenters there. no-drag so they stay clickable in the drag region. */
    #app-boot-controls {
      margin-left: auto; display: flex; align-items: center; height: 100%; padding-right: 4px;
      -webkit-app-region: no-drag;
      --wails-draggable: no-drag;
    }
    #app-boot-controls .app-boot-ctl {
      width: 30px; height: 30px; margin: 0 1px; padding: 0; border: 0; border-radius: 2px;
      background: transparent; color: #ffffff; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      -webkit-app-region: no-drag;
      --wails-draggable: no-drag;
    }
    #app-boot-controls .app-boot-ctl:hover { background: rgba(148, 163, 184, 0.15); }
    #app-boot-controls .app-boot-close:hover { background: #e11d48; }
    #app-boot-controls .app-boot-ctl svg { width: 18px; height: 18px; display: block; fill: currentColor; }
    html[data-boot-os="mac"] #app-boot-controls { display: none; }
    html[data-boot-os="mac"] #app-boot-brand { position: absolute; left: 50%; transform: translateX(-50%); }`;

// Boot DOM — the #root contents until React mounts and replaces them. The header embeds the single-source
// LOGO_SVG and the generated control buttons verbatim.
export const BOOT_CHROME_BODY = `
    <div id="app-splash" aria-hidden="true">
      <div class="app-splash-ring"></div>
    </div>
    <div id="app-boot-header">
      <div id="app-boot-brand" aria-hidden="true">
        ${LOGO_SVG}
      </div>
      <div id="app-boot-controls">
        ${BOOT_CONTROL_BUTTONS}
      </div>
    </div>`;

// Boot script — keeps the frameless window controllable before <AppHeader> mounts. Reaches the SAME main IPC
// channels the React header uses (preload exposes window.MessageBus before page scripts run). macOS gets the
// native traffic lights, so the custom set is hidden there. React removes #root — and this — once it mounts.
export const BOOT_CHROME_SCRIPT = `(function () {
      try {
        if ((navigator.userAgent || "").indexOf("Mac") !== -1) {
          document.documentElement.setAttribute("data-boot-os", "mac");
        }
        var controls = document.getElementById("app-boot-controls");
        if (controls) {
          controls.addEventListener("click", function (event) {
            var button = event.target && event.target.closest
              ? event.target.closest("button[data-window-action]")
              : null;
            if (!button) return;
            var action = button.getAttribute("data-window-action");
            try {
              if (window.MessageBus && typeof window.MessageBus.send === "function") {
                window.MessageBus.send(action);
              }
            } catch (err) { /* bridge not ready — ignore, the React header will take over */ }
          });
        }
      } catch (err) { /* never let boot chrome break startup */ }
    })();`;
