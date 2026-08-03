import type {
  ExtensionUIContext,
  ExtensionUIDialogOptions,
  ExtensionWidgetOptions,
} from "@earendil-works/pi-coding-agent";

import type { HostRpc } from "@/pi-agent-host/hostRpc";

// pi's Theme is an ANSI styling object: every method wraps text in escape codes. The GUI renders no ANSI, so
// styling is the identity function until Phase 5 brings the pi-tui surfaces in. The cast is on this shim alone —
// Theme is a class with private fields, and pi's own theme singleton is not part of its public export map.
const UNSTYLED_THEME = {
  name: "container-desktop-gui",
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
  underline: (text: string) => text,
  inverse: (text: string) => text,
  strikethrough: (text: string) => text,
  getFgAnsi: () => "",
  getBgAnsi: () => "",
  getColorMode: () => "truecolor",
  getThinkingBorderColor: () => (text: string) => text,
  getBashModeBorderColor: () => (text: string) => text,
} as unknown as ExtensionUIContext["theme"];

// Bridges pi's extension UI onto the app. Dialogs block the agent until the app answers and fall back to the
// value pi's own RPC mode uses on dismissal; chrome updates are fire-and-forget. Everything that needs a
// terminal to exist degrades exactly as pi documents for RPC mode, so a plugin guarding on `mode === "tui"`
// takes the right path instead of driving a surface we cannot render.
export function createGuiUiContext(rpc: HostRpc): ExtensionUIContext {
  const dialog = <T>(
    method: "select" | "confirm" | "input" | "editor",
    payload: Record<string, unknown>,
    fallback: T,
    opts?: ExtensionUIDialogOptions,
  ): Promise<T> => rpc.request<T>(method, payload, { timeoutMs: opts?.timeout, fallback, signal: opts?.signal });

  return {
    select: (title, options, opts) => dialog("select", { title, options }, undefined, opts),

    confirm: (title, message, opts) => dialog("confirm", { title, message }, false, opts),

    input: (title, placeholder, opts) => dialog("input", { title, placeholder }, undefined, opts),

    editor: (title, prefill) => dialog("editor", { title, prefill }, undefined),

    notify(message, notifyType) {
      rpc.notify("notify", { message, notifyType });
    },

    setStatus(key, text) {
      rpc.notify("setStatus", { statusKey: key, statusText: text });
    },

    setWidget(key: string, content: unknown, options?: ExtensionWidgetOptions) {
      // Component factories need a TUI to render into; Phase 5 picks them up. Dropping one is honest —
      // sending an empty widget would blank a strip the extension believes it filled.
      if (content !== undefined && !Array.isArray(content)) return;
      rpc.notify("setWidget", {
        widgetKey: key,
        widgetLines: content as string[] | undefined,
        widgetPlacement: options?.placement,
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

    async custom() {
      return undefined as never;
    },

    onTerminalInput: () => () => {},
    setWorkingMessage() {},
    setWorkingVisible() {},
    setWorkingIndicator() {},
    setHiddenThinkingLabel() {},
    setFooter() {},
    setHeader() {},
    addAutocompleteProvider() {},
    setEditorComponent() {},
    getEditorComponent: () => undefined,

    theme: UNSTYLED_THEME,
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: "themes are managed by the app" }),
    getToolsExpanded: () => false,
    setToolsExpanded() {},
  };
}
