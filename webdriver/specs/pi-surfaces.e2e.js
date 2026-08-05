import { strict as assert } from "node:assert";

// Verifies pi's component surfaces on the real renderer. The frames the container would send — the same
// `surface_frame` / `surface_closed` events `createSurfaceRegistry` emits, carrying real ANSI — are pushed
// through the store's own applyBridgeEvent, so the reducer, the placement and the xterm painting all run
// exactly as in a live session.
//
// Everything goes into ONE session and is read back as two DOM snapshots. A WebKitWebDriver session degrades
// over many round-trips, and ONE saveScreenshot per run is the hard limit (a command after a second one
// hangs and takes the session with it).

const ACCENT = "\x1b[38;2;20;184;166m";
const RESET = "\x1b[39m";

const FRAMES = [
  { surfaceId: "sf-header", slot: { kind: "header" }, lines: [`${ACCENT}welcome to the agent${RESET}`] },
  { surfaceId: "sf-footer", slot: { kind: "footer" }, lines: ["branch main · 2 extensions"] },
  {
    surfaceId: "sf-widget-above",
    slot: { kind: "widget", widgetKey: "clock", placement: "aboveEditor" },
    lines: ["12:00 · widget above"],
  },
  {
    surfaceId: "sf-widget-below",
    slot: { kind: "widget", widgetKey: "hint", placement: "belowEditor" },
    lines: ["widget below the composer"],
  },
  {
    surfaceId: "sf-tool",
    slot: { kind: "tool", toolCallId: "call-0", slot: "result" },
    lines: [`${ACCENT}deployed 3 services${RESET}`],
  },
  { surfaceId: "sf-inline", slot: { kind: "custom", surfaceId: "c1" }, lines: ["inline dialog"], focus: true },
  {
    surfaceId: "sf-overlay",
    slot: { kind: "custom", surfaceId: "c2" },
    lines: ["overlay dialog", "arrow keys move"],
    focus: true,
    overlay: true,
    placement: { anchor: "top-center", width: "50%" },
  },
];

let first = {};
let second = {};

describe("pi component surfaces", () => {
  before(async () => {
    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    await $('[data-screen="ai.assistant"]').waitForExist({
      timeout: 45000,
      timeoutMsg: "the Assistant screen never mounted",
    });

    // A recording stand-in for the bridge client: the store sends surface input through it, so this is what
    // proves a keystroke on a focused surface actually leaves the renderer.
    await browser.execute(() => {
      window.__cdSurfaceInput = [];
      window.__cdSurfaceResize = [];
      window.__cdSurfaceTheme = [];
      window.__cdCodingAgentStore.setState({
        status: "ready",
        view: { sessionId: "pi-session", phase: "idle", lastSeq: 0, timeline: [] },
        chrome: { statuses: {}, widgets: {} },
        surfaces: {},
        pendingDialog: undefined,
        client: {
          surfaceInput: async (surfaceId, data) => window.__cdSurfaceInput.push([surfaceId, data]),
          surfaceResize: async (surfaceId, columns) => window.__cdSurfaceResize.push([surfaceId, columns]),
          setTheme: async (palette) => window.__cdSurfaceTheme.push(palette),
          prompt: async () => {},
          abort: async () => {},
          respond: async () => {},
          onEvent: () => () => {},
          connect: async () => {},
          close: () => {},
        },
      });
    });

    // The tool card only exists once the transcript has that tool call, so the surface has a card to land in.
    await browser.execute((frames) => {
      const store = window.__cdCodingAgentStore.getState();
      store.applyBridgeEvent({ type: "tool_start", toolCallId: "call-0", toolName: "deploy", args: { env: "prod" } });
      store.applyBridgeEvent({
        type: "tool_end",
        toolCallId: "call-0",
        toolName: "deploy",
        isError: false,
        text: "done",
      });
      for (const frame of frames) {
        store.applyBridgeEvent({ type: "surface_frame", focus: false, overlay: false, ...frame });
      }
      store.applyBridgeEvent({ type: "idle" });
    }, FRAMES);

    await $(".AnsiSurface").waitForExist({ timeout: 20000, timeoutMsg: "no plugin surface ever rendered" });
    // xterm paints on an animation frame, so the rows are not in the DOM the instant a frame lands.
    await browser.pause(900);

    first = await browser.execute(() => {
      const read = (selector) =>
        Array.from(document.querySelectorAll(selector)).map((element) => element.textContent ?? "");
      const focusedTerminal = document.querySelector(".AnsiSurfaceOverlay .AnsiSurface");
      focusedTerminal?.focus();
      focusedTerminal?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
      return {
        surfaces: document.querySelectorAll(".AnsiSurface").length,
        header: read(".AnsiSurfacePanel--header .xterm-rows"),
        footer: read(".AssistantComposerDock .AnsiSurfacePanel--footer .xterm-rows"),
        widgetsAbove: read(".ExtensionWidgetStrip .AnsiSurface .xterm-rows"),
        tool: read(".AICard--plugin .xterm-rows"),
        overlay: read(".AnsiSurfaceOverlay .xterm-rows"),
        overlayAnchor: document.querySelector(".AnsiSurfaceOverlay")?.className ?? "",
        inlineFocus: read(".AnsiSurfacePanel--focus .xterm-rows"),
        // A truecolor SGR must reach the DOM as a real colour, or the theme derivation buys nothing.
        accentSpans: Array.from(document.querySelectorAll(".AnsiSurface .xterm-rows span")).filter((span) =>
          (span.getAttribute("style") ?? "").includes("rgb(20, 184, 166)"),
        ).length,
        nativeToolCard: document.querySelectorAll(".AICard--plugin").length,
      };
    });

    // Closing the overlay must hand the keyboard back to the surface it was opened over.
    await browser.execute(() => {
      window.__cdCodingAgentStore.getState().applyBridgeEvent({ type: "surface_closed", surfaceId: "sf-overlay" });
    });
    await browser.pause(700);

    // The engine attribute is what selects the `--app-*` token set, so changing it must re-derive the
    // palette and tell the container — that is the whole "plugin output follows the app theme" promise.
    await browser.execute(() => {
      window.__cdSurfaceThemeBefore = window.__cdSurfaceTheme.length;
      // Exactly what App.tsx sets: `data-theme` + `data-engine` on <html>, and the SAME theme as the body
      // class plus `data-engine` on <body>. `themes/tokens.css` keys its blocks on
      // `html[data-theme="bp6-*"][data-engine="…"]` and Blueprint keys its own on `body.bp6-*`, so setting
      // only one leaves the app half-switched — light tokens under dark controls.
      document.documentElement.setAttribute("data-engine", "docker");
      document.documentElement.setAttribute("data-theme", "bp6-light");
      document.body.setAttribute("data-engine", "docker");
      document.body.className = "bp6-light";
    });
    await browser.pause(700);

    second = await browser.execute(() => {
      const inline = document.querySelector(".AnsiSurfacePanel--focus .AnsiSurface");
      inline?.focus();
      inline?.dispatchEvent(new KeyboardEvent("keydown", { key: "q", bubbles: true }));
      return {
        overlays: document.querySelectorAll(".AnsiSurfaceOverlay").length,
        inlineFocus: Array.from(document.querySelectorAll(".AnsiSurfacePanel--focus .xterm-rows")).map(
          (element) => element.textContent ?? "",
        ),
        input: window.__cdSurfaceInput,
        resize: window.__cdSurfaceResize,
        themesPublished: window.__cdSurfaceTheme.length - window.__cdSurfaceThemeBefore,
        lastPalette: window.__cdSurfaceTheme.at(-1) ?? {},
        // What the webview actually computes each token to, so a palette gap names its own cause.
        computed: (() => {
          const probe = document.createElement("span");
          probe.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;opacity:0";
          document.body.appendChild(probe);
          const out = {};
          for (const token of ["--app-chrome", "--app-bg", "--app-surface", "--app-border", "--app-accent"]) {
            probe.style.color = "";
            probe.style.color = `var(${token})`;
            out[token] = `${getComputedStyle(probe).color} | raw=${getComputedStyle(document.body).getPropertyValue(token).trim()}`;
          }
          probe.remove();
          return out;
        })(),
      };
    });

    await browser.saveScreenshot(process.env.PI_SURFACES_SHOT ?? "/tmp/pi-surfaces.png");
  });

  it("paints every slot a plugin can occupy", () => {
    // One fewer than the frames sent: the focused overlay hides the surface it was opened over, which is
    // the next assertion. Every other slot — header, footer, both widgets, the tool row — is on screen.
    const onScreen = FRAMES.length - 1;
    assert.equal(first.surfaces, onScreen, `expected ${onScreen} surfaces, got ${first.surfaces}`);
  });

  it("puts the header above the transcript and the footer in the composer dock", () => {
    assert.ok(first.header.join(" ").includes("welcome to the agent"), `header missing: ${first.header}`);
    assert.ok(first.footer.join(" ").includes("branch main"), `footer missing: ${first.footer}`);
  });

  it("puts a component widget in the strip the extension asked for", () => {
    assert.ok(first.widgetsAbove.join(" ").includes("widget above"), `widget missing: ${first.widgetsAbove}`);
  });

  it("lets a tool that renders itself own its card body", () => {
    assert.equal(first.nativeToolCard, 1, "the tool call must render exactly one plugin card");
    assert.ok(first.tool.join(" ").includes("deployed 3 services"), `tool surface missing: ${first.tool}`);
  });

  it("floats an overlay at the anchor the plugin asked for, and hides the inline slot while it is up", () => {
    assert.ok(first.overlay.join(" ").includes("overlay dialog"), `overlay missing: ${first.overlay}`);
    assert.ok(
      first.overlayAnchor.includes("AnsiSurfaceOverlay--top-center"),
      `the requested anchor must be applied: ${first.overlayAnchor}`,
    );
    assert.equal(first.inlineFocus.length, 0, "only one surface holds focus at a time");
  });

  it("paints a truecolor escape as a real colour", () => {
    assert.ok(first.accentSpans > 0, "the accent SGR must reach the DOM as rgb(20, 184, 166)");
  });

  it("hands focus back to the surface underneath when the overlay closes", () => {
    assert.equal(second.overlays, 0, "the closed overlay must be gone");
    assert.ok(second.inlineFocus.join(" ").includes("inline dialog"), `inline surface missing: ${second.inlineFocus}`);
  });

  it("sends a focused surface's keystrokes to the container as terminal bytes", () => {
    assert.deepEqual(
      second.input,
      [
        ["sf-overlay", "\x1b[A"],
        ["sf-inline", "q"],
      ],
      `each keystroke must reach its own surface: ${JSON.stringify(second.input)}`,
    );
  });

  it("re-derives the app palette and sends it when the engine or mode repaints the tokens", () => {
    assert.ok(second.themesPublished > 0, "a token change must publish a fresh palette to the container");
    for (const key of ["bg", "surface", "text", "accent", "border", "success", "warning", "error"]) {
      assert.ok(
        /^#[0-9a-f]{6}$/i.test(second.lastPalette[key] ?? ""),
        `${key} must resolve to a hex: ${JSON.stringify(second.lastPalette)} computed=${JSON.stringify(second.computed)}`,
      );
    }
  });

  it("reports the measured width of every surface back to the container", () => {
    // At least once each, not exactly once: a surface re-measures whenever the layout moves under it.
    const reported = new Set(second.resize.map(([surfaceId]) => surfaceId));
    for (const frame of FRAMES) {
      assert.ok(reported.has(frame.surfaceId), `${frame.surfaceId} never reported a width`);
    }
    assert.ok(
      second.resize.every(([, columns]) => columns >= 20),
      `a reported width must be usable: ${JSON.stringify(second.resize)}`,
    );
  });
});
