// support/cdp.mjs — drive the running dev app over CDP for verification/screenshots.
//
// Attaches (does NOT launch) to the Electron renderer exposed on the Chrome DevTools Protocol port
// (`--remote-debugging-port=9222`, set by support/watch.mjs / `yarn dev`). It settles through dev-server
// reloads, optionally navigates to a hash route, prints a structured snapshot of the live app, runs an
// optional ad-hoc DOM/geometry expression, and writes a screenshot. It NEVER closes the app.
//
// Prereqs: the app must already be running (e.g. `CONTAINER_DESKTOP_MOCK=1 yarn dev`) with CDP on :9222.
//
// Usage:
//   node support/cdp.mjs [screenshot-path] [hash-route]
//   node support/cdp.mjs /tmp/app.png '#/screens/containers'
//   RELOAD=1 node support/cdp.mjs /tmp/app.png '#/screens/images'   # reload first (re-runs bootstrap/connectAll)
//   EVAL='document.title' node support/cdp.mjs /tmp/app.png          # run an expression in the page, print result
//   EVAL="$(cat /tmp/expr.js)" node support/cdp.mjs                  # multi-line expression from a file
//   CDP_URL=http://localhost:9222 node support/cdp.mjs               # override the CDP endpoint
//
// EVAL may be any JS expression (incl. an async IIFE returning a value); its result is printed as JSON.
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

// Endpoint discovery (no hardcoded port): explicit $CDP_URL wins, else the handshake file that
// support/watch.mjs writes with the actual (possibly auto-fallback) port, else the default :9222.
const CDP_ENDPOINT_FILE = path.join(os.tmpdir(), "container-desktop-cdp.json");
function discoverCdpUrl() {
  if (process.env.CDP_URL) {
    return process.env.CDP_URL;
  }
  try {
    if (existsSync(CDP_ENDPOINT_FILE)) {
      const { cdpUrl } = JSON.parse(readFileSync(CDP_ENDPOINT_FILE, "utf8"));
      if (cdpUrl) {
        return cdpUrl;
      }
    }
  } catch {
    // fall through to default
  }
  return "http://localhost:9222";
}
const CDP = discoverCdpUrl();
const shot = process.argv[2] || "/tmp/app.png";
const route = process.argv[3] || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.connectOverCDP(CDP).catch((e) => {
  console.error(`Unable to attach to ${CDP} — is the dev app running (yarn dev)? (${e.message})`);
  process.exit(1);
});
const pickPage = async () => {
  const pages = browser.contexts().flatMap((c) => c.pages());
  return pages.find((p) => p.url().startsWith("http://localhost") || p.url().startsWith("file://")) || pages[0];
};

// Chrome/structure of the live renderer (theme, engine, route, table heads/rows, per-row engine markers).
const readInfo = (page) =>
  page.evaluate(() => ({
    url: location.href,
    title: document.title,
    engine: document.body?.getAttribute("data-engine"),
    theme: document.documentElement?.getAttribute("data-theme"),
    phase: document.documentElement?.getAttribute("data-phase"),
    running: document.documentElement?.getAttribute("data-running"),
    footer: document.querySelector(".AppFooter")?.textContent?.trim()?.slice(0, 240) || null,
    screen: document.querySelector(".AppScreen")?.getAttribute("data-screen") || null,
    tableHead: Array.from(document.querySelectorAll(".AppDataTable thead th")).map((n) => n.textContent?.trim()),
    rows: document.querySelectorAll(".AppDataTable tbody tr").length,
    rowEngines: Array.from(document.querySelectorAll(".AppDataTable tbody tr[data-engine-row]")).map((n) =>
      n.getAttribute("data-engine-row"),
    ),
    ready: !!document.querySelector(".App"),
  }));

// Authoritative multi-connection signal: main's merged data layer over the preload bridge (which
// connections are up, per-domain counts, and each connection's runtime).
const readSnapshot = (page) =>
  page.evaluate(async () => {
    try {
      const snap = await window.MessageBus.invoke("resource:get-snapshot");
      if (!snap) return null;
      const resources = snap.resources || {};
      const counts = {};
      for (const [id, byDomain] of Object.entries(resources)) {
        counts[id] = {};
        for (const [domain, items] of Object.entries(byDomain)) counts[id][domain] = (items || []).length;
      }
      return {
        connections: Object.keys(resources),
        counts,
        active: (snap.appRuntime?.active || []).map((a) => ({
          id: a.id,
          engine: a.engine,
          phase: a.phase,
          running: a.running,
          error: a.error,
        })),
        primary: snap.appRuntime?.currentConnector?.id || null,
      };
    } catch (e) {
      return { error: String(e?.message || e) };
    }
  });

let page = await pickPage();
if (process.env.RELOAD && page) {
  // Re-run the renderer bootstrap (initialize → startApplication → connectAll) with current code.
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await sleep(1500);
}

// Settle through dev-boot navigations.
let info;
for (let i = 0; i < 45; i++) {
  page = await pickPage();
  if (!page) {
    await sleep(1000);
    continue;
  }
  try {
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    info = await readInfo(page);
    if (info.ready && info.phase === "ready") break;
  } catch {
    // execution context destroyed mid-navigation — retry
  }
  await sleep(1000);
}

if (route) {
  try {
    page = await pickPage();
    await page.evaluate((h) => {
      location.hash = h;
    }, route);
    await sleep(1200);
    info = await readInfo(page);
  } catch (e) {
    console.log("navigate failed:", e.message);
  }
}

let snapshot = null;
try {
  page = await pickPage();
  snapshot = await readSnapshot(page);
} catch (e) {
  snapshot = { error: e.message };
}

// Ad-hoc DOM measurement: EVAL='<expression>' node support/cdp.mjs ...
if (process.env.EVAL) {
  try {
    page = await pickPage();
    const r = await page.evaluate(process.env.EVAL);
    console.log("EVAL:", JSON.stringify(r, null, 2));
  } catch (e) {
    console.log("EVAL err:", e.message);
  }
}

console.log(JSON.stringify({ info: info ?? { error: "no info" }, snapshot }, null, 2));

try {
  page = await pickPage();
  await page.bringToFront().catch(() => {});
  await page.screenshot({ path: shot, animations: "disabled", timeout: 20000 });
  console.log("screenshot ->", shot);
} catch (e) {
  console.log("screenshot failed:", e.message);
}
process.exit(0);
