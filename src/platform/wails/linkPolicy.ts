// Decide whether a clicked anchor should be routed to the OS browser (external link) or left to the in-app
// router. Extracted as a pure helper so it stays hermetically testable — bridge.ts pulls the full Wails API
// surface, which a Node unit test can't load.
//
// The subtlety this guards: under Electron the app is served over file://, so in-app hash routes (Navigator
// pathTo emits `file://…#/screens/…`) are never http(s) and are trivially ignored by an external-link handler.
// Under Wails the app origin is itself http(s) (`http://wails.localhost`), so pathTo emits
// `${origin}/#/screens/…` — an absolute http(s) href. Testing only the URL scheme would then hijack EVERY
// in-app navigation (the Phase D sidebar regression). The correct discriminator is ORIGIN: a real external link
// points to a DIFFERENT origin; same-origin http(s) — including hash routes — is in-app navigation.

/** True only for an http(s) link whose origin differs from the app's — the links that belong in the OS browser. */
export function isExternalHttpLink(href: string, appOrigin: string): boolean {
  if (!/^https?:/i.test(href)) {
    return false; // relative / file:// / blob: / mailto: / empty — never an external browser link
  }
  try {
    return new URL(href).origin !== appOrigin;
  } catch {
    return false; // unparseable → treat as in-app / ignore rather than swallow the click
  }
}
