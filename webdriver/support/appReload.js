// Reloading the app, and KNOWING you are on the new document.
//
// `browser.execute(() => window.location.reload())` returns before the reload has happened, and every seam a spec
// would wait for afterwards — `window.MessageBus`, `window.Preloaded` — is present on the OLD document too. So the
// wait is satisfied by the page that is about to be thrown away, and whatever the spec does next lands on it:
// measured, a hash set that way was gone the moment the reload landed, the app booted into its DEFAULT route, and the
// spec reported a screen that never mounted 45 seconds later, with a perfectly healthy app on screen.
//
// A sentinel set BEFORE the reload is the only thing that tells the two documents apart, because it cannot survive
// one. `window.Preloaded` is checked as well — the host bridge sets it LAST, once its globals are up — so this
// returns on a new document that has finished booting rather than on a blank one still parsing its module graph.

const SENTINEL = "__cdReloadSentinel";

export async function reloadApp(timeoutMs = 90000) {
  await browser.execute((key) => {
    window[key] = true;
    window.location.reload();
  }, SENTINEL);
  await browser.waitUntil(
    async () =>
      await browser
        .execute(
          (key) => window[key] !== true && window.Preloaded === true && !!window.MessageBus,
          SENTINEL,
        )
        .catch(() => false),
    { timeout: timeoutMs, interval: 250, timeoutMsg: "the renderer never came back after the reload" },
  );
}
