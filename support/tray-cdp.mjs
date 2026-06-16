// Dev-only CDP driver for the tray-widget work. Attaches to the running `yarn dev`
// Electron instance (CDP on :9222) and drives/inspects its windows. NOT shipped.
//
// Usage:
//   node support/tray-cdp.mjs list                 # list all open windows (url + title)
//   node support/tray-cdp.mjs snapshot [urlpart]   # a11y/text snapshot of a window (default: #tray, else main)
//   node support/tray-cdp.mjs shot <file> [urlpart] # screenshot a window to <file>
//   node support/tray-cdp.mjs eval "<js>" [urlpart] # evaluate JS in a window and print the result
//
// urlpart is a substring matched against page.url() (e.g. "#tray" for the popover).
import { chromium } from "playwright-core";

const ENDPOINT = process.env.CDP_ENDPOINT || "http://127.0.0.1:9222";
const [cmd, ...rest] = process.argv.slice(2);

const browser = await chromium.connectOverCDP(ENDPOINT);

function allPages() {
  return browser.contexts().flatMap((c) => c.pages());
}

async function pick(urlpart) {
  const pages = allPages();
  if (urlpart) {
    const hit = pages.find((p) => p.url().includes(urlpart));
    if (hit) return hit;
  }
  // default: prefer the tray popover if present, else the first non-devtools app window
  return (
    pages.find((p) => p.url().includes("#tray")) ||
    pages.find((p) => !p.url().startsWith("devtools://")) ||
    pages[0]
  );
}

try {
  if (cmd === "list" || !cmd) {
    for (const p of allPages()) {
      let title = "";
      try {
        title = await p.title();
      } catch {}
      console.log(`${p.url()}\t${JSON.stringify(title)}`);
    }
  } else if (cmd === "snapshot") {
    const page = await pick(rest[0]);
    console.log("URL:", page.url());
    console.log(await page.locator("body").innerText());
  } else if (cmd === "shot") {
    const file = rest[0];
    const page = await pick(rest[1]);
    await page.screenshot({ path: file });
    console.log("Saved", file, "from", page.url());
  } else if (cmd === "eval") {
    const page = await pick(rest[1]);
    const result = await page.evaluate(rest[0]);
    console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
  } else if (cmd === "capture") {
    // Single-session: toggle the widget from the main window, then screenshot the popover before
    // blur-hide can tear it down (separate connect/disconnect cycles race the hide timer).
    const file = rest[0] || "/tmp/tray.png";
    const main = allPages().find((p) => !p.url().startsWith("devtools://") && !p.url().includes("#tray"));
    if (main) {
      await main.evaluate("window.MessageBus.send('tray:dev-toggle')");
    }
    let tray = null;
    for (let i = 0; i < 40; i++) {
      tray = allPages().find((p) => p.url().includes("#tray"));
      if (tray) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!tray) {
      console.error("tray page not found");
    } else {
      await new Promise((r) => setTimeout(r, 500));
      await tray.screenshot({ path: file });
      console.log("captured", file, "from", tray.url());
    }
  } else {
    console.error("unknown cmd:", cmd);
  }
} finally {
  // Disconnect from CDP without terminating the Electron app.
  await browser.close().catch(() => {});
}
