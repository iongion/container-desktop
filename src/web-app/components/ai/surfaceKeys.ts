// A webview `keydown` is a key identity; pi reads terminal bytes. This is the translation, checked
// against pi's own `parseKey` legacy table (`@earendil-works/pi-tui` keys.ts) — the GUI never
// negotiates the kitty protocol, so the legacy sequences are the ones pi will decode.
const SPECIAL_KEYS: Record<string, string> = {
  Enter: "\r",
  Tab: "\t",
  Backspace: "\x7f",
  Escape: "\x1b",
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
  Delete: "\x1b[3~",
  Insert: "\x1b[2~",
};

export type SurfaceKeyEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey"> & { metaKey?: boolean };

// `undefined` means the surface does not consume this key — the caller leaves it to the browser, so
// the app's own shortcuts and the clipboard keep working while a surface has focus.
export function keyEventToTerminalData(event: SurfaceKeyEvent): string | undefined {
  const { key, ctrlKey, altKey, shiftKey } = event;
  if (event.metaKey) return undefined;
  // Ctrl+Shift+key is the webview's copy/paste, not a control code.
  if (ctrlKey && shiftKey) return undefined;

  if (key === "Tab" && shiftKey) return "\x1b[Z";

  const special = SPECIAL_KEYS[key];
  if (special) return altKey ? `\x1b${special}` : special;

  if (ctrlKey) return controlCode(key);

  // Anything longer than one code point is a named key this map does not carry (F13, ContextMenu,
  // and the bare modifiers) — pi has no legacy sequence for those either.
  if ([...key].length !== 1) return undefined;
  return altKey ? `\x1b${key}` : key;
}

function controlCode(key: string): string | undefined {
  if (key === " ") return "\x00";
  const lower = key.toLowerCase();
  if (lower.length !== 1) return undefined;
  const code = lower.charCodeAt(0);
  // ctrl+a..ctrl+z are 0x01..0x1a, the mapping every terminal has used since ASCII.
  if (code >= 97 && code <= 122) return String.fromCharCode(code - 96);
  return undefined;
}
