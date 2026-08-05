import type {
  ExtensionUIContext,
  ExtensionUIDialogOptions,
  ExtensionWidgetOptions,
  ReadonlyFooterDataProvider,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, EditorTheme, OverlayOptions, TUI } from "@earendil-works/pi-tui";

import { createLogger } from "@/logger";
import type { HostRpc } from "@/pi-agent-host/hostRpc";
import type { SurfaceComponent, SurfaceRegistry } from "@/pi-agent-host/surfaces";
import type { SurfaceOverlayPlacement } from "@/pi-bridge/protocol";

const logger = createLogger("pi-agent-host.uiContext");

type DisposableComponent = Component & { dispose?(): void };
type ComponentFactory = (tui: TUI, theme: Theme) => DisposableComponent;
type FooterFactory = (tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider) => DisposableComponent;
// pi declares these shapes but does not export the aliases, and its own context is the single origin
// worth trusting — reading them back off the interface can never drift.
type EditorFactory = NonNullable<ReturnType<ExtensionUIContext["getEditorComponent"]>>;
export type PiKeybindings = Parameters<Parameters<ExtensionUIContext["custom"]>[0]>[2];

export interface GuiUiContextOptions {
  rpc: HostRpc;
  tui: TUI;
  surfaces: SurfaceRegistry;
  theme: Theme;
  keybindings: PiKeybindings;
  gitBranch?: string | null;
}

export interface GuiUiContext {
  ui: ExtensionUIContext;
  // One keystroke from the renderer: extension terminal-input listeners get first refusal, exactly as
  // pi's own TUI gives them, then the surface's component sees whatever is left.
  handleSurfaceInput(surfaceId: string, data: string): void;
  applyTheme(theme: Theme): void;
  getToolsExpanded(): boolean;
  getEditorComponentFactory(): EditorFactory | undefined;
}

// Bridges pi's extension UI onto the app. Dialogs block the agent until the app answers and fall back to
// the value pi's own RPC mode uses on dismissal; chrome updates are fire-and-forget. Components render to
// ANSI line frames through the surface registry, which is what earns `mode: "tui"` — a plugin guarding on
// it now gets a surface it can actually draw into.
export function createGuiUiContext(options: GuiUiContextOptions): GuiUiContext {
  const { rpc, tui, surfaces } = options;
  let theme = options.theme;
  let toolsExpanded = false;
  let editorFactory: EditorFactory | undefined;
  let customSurfaceCount = 0;
  const statuses = new Map<string, string>();
  const terminalInputHandlers = new Set<(data: string) => { consume?: boolean; data?: string } | undefined>();

  const dialog = <T>(
    method: "select" | "confirm" | "input" | "editor",
    payload: Record<string, unknown>,
    fallback: T,
    opts?: ExtensionUIDialogOptions,
  ): Promise<T> => rpc.request<T>(method, payload, { timeoutMs: opts?.timeout, fallback, signal: opts?.signal });

  // pi's own footer data, minus the git watcher: the branch is resolved once by the session and the
  // statuses are the ones extensions publish through setStatus, so a real footer component renders.
  const footerData: ReadonlyFooterDataProvider = {
    getGitBranch: () => options.gitBranch ?? null,
    getExtensionStatuses: () => statuses,
    getAvailableProviderCount: () => 1,
    onBranchChange: () => () => {},
  };

  const build = <T>(what: string, make: () => T): T | undefined => {
    try {
      return make();
    } catch (error) {
      // A plugin factory that throws must cost it its widget, not the session.
      logger.error(`${what} factory threw`, error);
      return undefined;
    }
  };

  const ui: ExtensionUIContext = {
    select: (title, choices, opts) => dialog("select", { title, options: choices }, undefined, opts),

    confirm: (title, message, opts) => dialog("confirm", { title, message }, false, opts),

    input: (title, placeholder, opts) => dialog("input", { title, placeholder }, undefined, opts),

    editor: (title, prefill) => dialog("editor", { title, prefill }, undefined),

    notify(message, notifyType) {
      rpc.notify("notify", { message, notifyType });
    },

    setStatus(key, text) {
      if (text === undefined) statuses.delete(key);
      else statuses.set(key, text);
      rpc.notify("setStatus", { statusKey: key, statusText: text });
    },

    setWidget(key: string, content: unknown, widgetOptions?: ExtensionWidgetOptions) {
      const slot = { kind: "widget" as const, widgetKey: key, placement: widgetOptions?.placement };
      if (typeof content === "function") {
        const component = build("widget", () => (content as ComponentFactory)(tui, theme));
        if (component) surfaces.open(slot, component as SurfaceComponent);
        return;
      }
      // A component surface and a line widget occupy the same strip: swapping between the two must
      // retire the other, or the extension's older shape stays on screen forever.
      surfaces.closeSlot(slot);
      rpc.notify("setWidget", {
        widgetKey: key,
        widgetLines: content as string[] | undefined,
        widgetPlacement: widgetOptions?.placement,
      });
    },

    setTitle(title) {
      rpc.notify("setTitle", { title });
    },

    setEditorText(text) {
      rpc.notify("setEditorText", { text });
    },

    pasteToEditor(text) {
      // No paste-collapse without an editor component, so this is a plain replace — same as pi's RPC mode.
      rpc.notify("setEditorText", { text });
    },

    getEditorText: () => "",

    custom<T>(
      factory: (
        tuiInstance: TUI,
        currentTheme: Theme,
        keys: PiKeybindings,
        done: (result: T) => void,
      ) => DisposableComponent | Promise<DisposableComponent>,
      customOptions?: {
        overlay?: boolean;
        overlayOptions?: OverlayOptions | (() => OverlayOptions);
        onHandle?: (handle: never) => void;
      },
    ): Promise<T> {
      customSurfaceCount += 1;
      const slot = { kind: "custom" as const, surfaceId: `custom-${customSurfaceCount}` };
      let settled = false;
      let surfaceId: string | undefined;
      let resolvePending!: (value: T) => void;
      const pending = new Promise<T>((resolve) => {
        resolvePending = resolve;
      });

      // Closing the surface and settling the promise are two ways to end the same dialog; whichever
      // happens first wins, and the other becomes a no-op.
      const settle = (result: T) => {
        if (settled) return;
        settled = true;
        resolvePending(result);
        if (surfaceId) surfaces.close(surfaceId);
      };
      const mount = (component: DisposableComponent) => {
        if (settled) {
          component.dispose?.();
          return;
        }
        surfaceId = surfaces.open(slot, component as SurfaceComponent, {
          focus: true,
          overlay: customOptions?.overlay === true,
          placement: toSurfacePlacement(customOptions?.overlayOptions),
          // A surface closed from the app side (the session ending, the slot reused) must still
          // release the plugin's await, or its command never returns.
          onClose: () => settle(undefined as T),
        });
      };
      const fail = (error: unknown) => {
        logger.error("custom component factory failed", error);
        settle(undefined as T);
      };

      // A synchronous factory — which is what nearly every plugin writes — mounts before this returns,
      // so the dialog is on screen in the same tick the extension asked for it.
      try {
        const created = factory(tui, theme, options.keybindings, settle);
        if (created instanceof Promise) created.then(mount).catch(fail);
        else mount(created);
      } catch (error) {
        fail(error);
      }
      return pending;
    },

    onTerminalInput(handler) {
      terminalInputHandlers.add(handler);
      return () => terminalInputHandlers.delete(handler);
    },

    // The app has its own working indicator above the composer, so all three land on it. Sent even when the
    // argument is absent: calling with nothing is how pi restores the default, which is a change, not a no-op.
    setWorkingMessage(message) {
      rpc.notify("setWorking", { workingMessage: message });
    },

    setWorkingVisible(visible) {
      rpc.notify("setWorking", { workingVisible: visible });
    },

    // Frames travel so the renderer can read pi's own "frames: [] means hide it"; it animates its own spinner
    // rather than painting a plugin's glyphs, which would look foreign next to Blueprint's.
    setWorkingIndicator(indicatorOptions) {
      rpc.notify("setWorking", { workingFrames: indicatorOptions?.frames });
    },

    // Deliberately still nothing: the GUI has no collapsed-thinking row to label. Giving it one is a visual
    // change with no agreed design, and a label sent nowhere would be worse than an honest silence.
    setHiddenThinkingLabel() {},

    setFooter(factory: FooterFactory | undefined) {
      openChromeSlot({ kind: "footer" }, factory && (() => factory(tui, theme, footerData)));
    },

    setHeader(factory: ComponentFactory | undefined) {
      openChromeSlot({ kind: "header" }, factory && (() => factory(tui, theme)));
    },

    // A round trip per keystroke for a list that is redrawn on every one of them. The GUI composer owns
    // completion; wiring this belongs with the composer work, not the surfaces.
    addAutocompleteProvider() {},

    setEditorComponent(factory: EditorFactory | undefined) {
      editorFactory = factory;
      if (!factory) {
        surfaces.closeSlot({ kind: "editor" });
        return;
      }
      const component = build("editor", () => factory(tui, editorTheme(theme), options.keybindings));
      if (component) surfaces.open({ kind: "editor" }, component as SurfaceComponent, { focus: true });
    },

    getEditorComponent: () => editorFactory,

    get theme() {
      return theme;
    },

    getAllThemes: () => [{ name: theme.name ?? "container-desktop", path: undefined }],

    getTheme: (name) => (name === theme.name ? theme : undefined),

    setTheme: (requested) => {
      const name = typeof requested === "string" ? requested : requested.name;
      if (name === theme.name) return { success: true };
      return { success: false, error: "the theme follows the app's own tokens and cannot be switched from here" };
    },

    getToolsExpanded: () => toolsExpanded,

    setToolsExpanded(expanded) {
      toolsExpanded = expanded;
    },
  };

  function openChromeSlot(slot: { kind: "footer" | "header" }, make: (() => DisposableComponent) | undefined) {
    if (!make) {
      surfaces.closeSlot(slot);
      return;
    }
    const component = build(slot.kind, make);
    if (component) surfaces.open(slot, component as SurfaceComponent);
  }

  return {
    ui,

    handleSurfaceInput(surfaceId, data) {
      let payload: string | undefined = data;
      for (const handler of [...terminalInputHandlers]) {
        let result: { consume?: boolean; data?: string } | undefined;
        try {
          result = handler(payload);
        } catch (error) {
          logger.error("terminal input listener threw", error);
        }
        if (result?.data !== undefined) payload = result.data;
        if (result?.consume) return;
      }
      if (payload !== undefined) surfaces.input(surfaceId, payload);
    },

    applyTheme(next) {
      theme = next;
    },

    getToolsExpanded: () => toolsExpanded,

    getEditorComponentFactory: () => editorFactory,
  };
}

// pi's editors take an EditorTheme, not a Theme: a border styler plus the select-list palette. Both are
// built off the app's derived theme rather than pi's `getSelectListTheme()`, which closes over pi's own
// global — that would paint a plugin's editor in pi's default colours next to the app's.
function editorTheme(theme: Theme): EditorTheme {
  return {
    borderColor: (text: string) => theme.fg("borderMuted", text),
    selectList: {
      selectedPrefix: (text: string) => theme.fg("accent", text),
      selectedText: (text: string) => theme.fg("accent", text),
      description: (text: string) => theme.fg("muted", text),
      scrollInfo: (text: string) => theme.fg("muted", text),
      noMatch: (text: string) => theme.fg("muted", text),
    },
  };
}

// pi's overlay options carry layout callbacks and terminal margins the renderer has no use for; only the
// anchor and the size survive the trip, and a dynamic options function is asked once, when it opens.
function toSurfacePlacement(
  overlayOptions: OverlayOptions | (() => OverlayOptions) | undefined,
): SurfaceOverlayPlacement | undefined {
  if (!overlayOptions) return undefined;
  let resolved: OverlayOptions;
  try {
    resolved = typeof overlayOptions === "function" ? overlayOptions() : overlayOptions;
  } catch (error) {
    logger.error("overlay options function threw", error);
    return undefined;
  }
  const placement: SurfaceOverlayPlacement = {};
  if (resolved.anchor) placement.anchor = resolved.anchor;
  if (resolved.width !== undefined) placement.width = resolved.width;
  if (resolved.maxHeight !== undefined) placement.maxHeight = resolved.maxHeight;
  return Object.keys(placement).length > 0 ? placement : undefined;
}
