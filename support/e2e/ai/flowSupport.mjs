// Backend-agnostic AI end-to-end flows. Each flow drives the real running app through an `AiE2eDriver` port and
// asserts an observable behavior — so the SAME flow runs on either shell:
// WebdriverIO/W3C-WebDriver (Tauri). These formalize the manual CDP checks used to verify the XState→robot3/closure
// AI-subsystem rewrite: a chat message is echoed and answered by the Assistant, a Team Run is planned/approved/run,
// and the workers library round-trips. All page logic lives in self-contained `evaluate`/`waitFor` functions (identical
// serialized JS on both engines); the driver supplies only navigation, evaluation, waiting, and screenshots.
//
// @typedef {Object} AiE2eDriver
// @property {(hashRoute: string) => Promise<void>} goto           Navigate the renderer to a `#/...` hash route.
// @property {(fn: Function, arg?: any) => Promise<any>} evaluate  Run a self-contained function in the page, return its value.
// @property {(fn: Function, arg?: any, opts?: {timeout?: number, message?: string}) => Promise<void>} waitFor  Poll a page predicate until truthy.
// @property {(text: string) => Promise<void>} typeText             Type through the shell's real keyboard driver.
// @property {(key: string) => Promise<void>} press                 Press a key through the shell's real keyboard driver.
// @property {(path: string) => Promise<void>} screenshot         Write a viewport PNG (best-effort; may no-op).
// @property {() => Promise<void>} close                          Detach/teardown the driver.
//
// @typedef {{ name: string, ok: boolean, detail: string }} FlowResult

// Set the Blueprint composer's controlled textarea (via the native value setter so React's onChange fires) and
// press its Send button. Returned as a string of the function so both drivers serialize identical page JS.
export function submitComposer(arg) {
  const { text, screenId } = arg;
  const ta = document.querySelector(`[data-screen="${screenId}"] .AIComposerInput`);
  if (!ta) return { ok: false, reason: "no composer textarea" };
  ta.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(ta, text);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  return { ok: true };
}

// Set any Blueprint InputGroup/TextArea by CSS selector via the native value setter (so React's onChange fires) —
// the general form of submitComposer for the worker/run editors. Returns false when the field is absent.
export function setFieldValue(arg) {
  const { selector, value } = arg;
  const el = document.querySelector(selector);
  if (!el) return false;
  const proto =
    el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

// Select a worker "Runs on" execution kind (host/remote/container/sandbox) on the editor's native <select> — found
// by the unique "sandbox" option so it is never confused with the container picker. Returns false if not found.
export function selectExecutionKind(kind) {
  const select = [...document.querySelectorAll('[data-form="ai.worker.edit"] select')].find((s) =>
    [...s.options].some((o) => o.value === "sandbox"),
  );
  if (!select) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  setter.call(select, kind);
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

// Readiness MUST be scoped to the screen under test. Several AI screens render an <AIComposer>, so an
// unscoped ".AIComposerInput" check is satisfied by whichever screen the previous flow left mounted — the flow
// would then type into that one and wait forever for its marker to appear on the screen it meant to drive.
export const composerReadyOn = (screenId) => !!document.querySelector(`[data-screen="${screenId}"] .AIComposerInput`);
export const sendEnabledOn = (screenId) => {
  const button = document.querySelector(`[data-screen="${screenId}"] .AIComposerSend`);
  return !!button && !button.disabled;
};
export const screenText = () => document.querySelector(".AppScreen")?.textContent || "";

export async function closeOpenAppDrawer(driver) {
  const closed = await driver.evaluate(() => {
    const close = document.querySelector(".bp6-drawer .AppDrawerHeaderActions button:last-child");
    if (!close) return false;
    close.click();
    return true;
  });
  if (!closed) return;
  await driver.waitFor(() => !document.querySelector(".bp6-drawer"), undefined, {
    timeout: 3000,
    message: "close existing app drawer",
  });
}

// Reliably start a FRESH assistant session. The flows share one app session, and a prior flow's turn can still be
// streaming when the next submits — the interactive engine treats a submit into an active session as STEERING (it
// interrupts that turn), so a gated-tool message would land in the previous chat and its approval card would
// auto-resolve. So: wait for any in-flight turn to settle (the Stop control shows only while a turn is active),
// click New chat, then wait for the transcript to actually clear before the flow submits.
export async function newAssistantChat(driver) {
  await closeOpenAppDrawer(driver);
  await driver.waitFor(() => !document.querySelector('[data-screen="ai.assistant"] .AIComposerStop'), undefined, {
    timeout: 20000,
    message: "assistant idle before new chat",
  });
  const activeThreadId = await driver.evaluate(() => localStorage.getItem("container-desktop:ai:active-thread"));
  await driver.evaluate(() => {
    document.querySelector('[data-screen="ai.assistant"] [data-action="new-thread"]')?.click();
  });
  await driver.waitFor(
    (previousThreadId) => {
      const nextThreadId = localStorage.getItem("container-desktop:ai:active-thread");
      return !!nextThreadId && nextThreadId !== previousThreadId;
    },
    activeThreadId,
    { timeout: 3000, message: "new Thread selected" },
  );
  await driver.waitFor(() => document.querySelectorAll(".AssistantMessage").length === 0, undefined, {
    timeout: 8000,
    message: "fresh empty chat",
  });
  await driver.evaluate(() => {
    const input = document.querySelector('[data-screen="ai.assistant"] .AIComposerInput');
    if (!(input instanceof HTMLTextAreaElement)) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await driver.waitFor(
    () =>
      document.querySelector('[data-screen="ai.assistant"] .AIComposerInput')?.value === "" &&
      !document.querySelector(".AssistantCommandPalette"),
    undefined,
    { timeout: 3000, message: "fresh empty composer" },
  );
}

/** @param {AiE2eDriver} driver @returns {Promise<FlowResult>} */
