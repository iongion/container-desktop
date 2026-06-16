// Dev-only CDP smoke: verify the running app's MAIN renderer mounts and is free of console/page errors.
// Catches runtime/boot/wiring regressions that tsc + hermetic tests can't. NOT shipped.
//
// Two modes:
//   node support/dev-smoke.mjs [seconds]            attach to an already-running `yarn dev` (CDP :9222)
//   node support/dev-smoke.mjs --spawn [seconds]    spawn `yarn dev`, wait for it, smoke, then kill it
//
// --spawn keeps everything inside one foreground Node process (no shell `&`), which avoids the
// background-process sandbox kills.
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const ENDPOINT = process.env.CDP_ENDPOINT || "http://127.0.0.1:9222";
const args = process.argv.slice(2);
const SPAWN = args.includes("--spawn");
const WATCH_MS = (Number(args.find((a) => !a.startsWith("--"))) || 8) * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${ENDPOINT}/json/version`);
      if (res.ok) return true;
    } catch {}
    await sleep(1000);
  }
  return false;
}

let child;
// Kill ONLY the dev server we spawned (its process group) — never a broad pkill, which could also kill
// an unrelated Electron/Vite the user is running in another project on this machine.
function killSpawned() {
  if (child?.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
}

let exitCode = 0;
try {
  if (SPAWN) {
    child = spawn("yarn", ["dev"], {
      cwd: process.cwd(),
      env: { ...process.env, ENVIRONMENT: "development" },
      stdio: "ignore",
      detached: true,
    });
    if (!(await cdpReady(45000))) throw new Error(`CDP ${ENDPOINT} never came up`);
  }

  const browser = await chromium.connectOverCDP(ENDPOINT);
  const allPages = () => browser.contexts().flatMap((c) => c.pages());

  // Wait for the main app window (any http(s) dev-server URL, not the tray popover, not devtools).
  // Port-agnostic: Vite falls back to another port if the default is taken.
  let main;
  for (let i = 0; i < 30 && !main; i++) {
    main = allPages().find((p) => p.url().startsWith("http") && !p.url().includes("#tray"));
    if (!main) await sleep(1000);
  }
  if (!main) {
    console.error("SMOKE FAIL: no main app window. Windows:", allPages().map((p) => p.url()));
    await browser.close().catch(() => {});
    exitCode = 2;
  } else {
    const errors = [];
    main.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
    });
    main.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

    await sleep(WATCH_MS);

    const probe = await main.evaluate(() => ({
      url: location.href,
      title: document.title,
      rootChildren: document.getElementById("root")?.children.length ?? 0,
      bodyTextLen: (document.body?.innerText || "").length,
    }));
    console.log("URL:", probe.url);
    console.log("title:", JSON.stringify(probe.title));
    console.log("#root children:", probe.rootChildren, "| body text length:", probe.bodyTextLen);

    // Main owns the data — prove the broker↔renderer pipe: the renderer can pull a snapshot from main.
    const snap = await main.evaluate(() => window.MessageBus.invoke("resource:get-snapshot"));
    const ok = !!snap && typeof snap === "object" && !!snap.appRuntime;
    console.log(
      "resource:get-snapshot →",
      ok ? `appRuntime.phase=${snap.appRuntime.phase}, connections=${snap.appRuntime.connections.length}` : "NO SNAPSHOT",
    );
    if (!ok) {
      console.error("SMOKE FAIL: broker returned no snapshot (main-owned data not reaching the renderer).");
      await browser.close().catch(() => {});
      if (SPAWN) killSpawned();
      process.exit(6);
    }
    console.log(`errors captured in ${WATCH_MS / 1000}s:`, errors.length);
    for (const e of errors) console.log("  -", e);
    await browser.close().catch(() => {});

    const mounted = probe.rootChildren > 0 && probe.bodyTextLen > 0;
    if (!mounted) {
      console.error("SMOKE FAIL: renderer did not mount (empty #root/body).");
      exitCode = 3;
    } else if (errors.length > 0) {
      console.error(`SMOKE FAIL: ${errors.length} renderer error(s).`);
      exitCode = 4;
    } else {
      console.log("SMOKE PASS: renderer mounted, no console/page errors.");
    }
  }
} catch (error) {
  console.error("SMOKE ERROR:", error?.message || error);
  exitCode = 5;
} finally {
  if (SPAWN) killSpawned();
}
process.exit(exitCode);
