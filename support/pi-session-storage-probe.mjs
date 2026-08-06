// Proves the conversation-storage RPC against the REAL agent image, with no app and no WebDriver in the way.
//
// This is the only way to see the whole mechanism actually work: pi's patched `SessionManager` inside the container,
// the synchronous storage port, the worker thread that owns the socket, the shared window it hands bytes across, and
// this script standing in for the app's side of it. What it asserts is the claim the feature makes — the conversation
// lands on THIS machine and nothing of it is written inside the container.
//
// It needs no remote engine: the transport is a published loopback port either way, and the ssh forward that carries
// it for a remote engine is proven separately. What it does need is a current image.
//
//   yarn cli agent-image --engine podman
//   node support/pi-session-storage-probe.mjs
//   node support/pi-session-storage-probe.mjs --engine docker
//
// Exits non-zero with the reason on any failure, so it reads as a test.

import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const engine = arg("engine", "podman");
const version = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;
// Podman shows a local image with a `localhost/` prefix and docker leaves it bare, so the short name is what probes.
const image = `container-desktop/pi-agent:${version}`;
const NAME = "cd-session-storage-probe";
const SESSIONS_DIR_IN_IMAGE = "/home/agent/.cd/sessions";
const STORAGE_PORT_IN_IMAGE = 8789;
const token = "probe-token";
const storagePort = 41500 + Math.floor(Math.random() * 3000);

const failures = [];
function check(what, ok, detail) {
  if (ok) console.log(`  ok   ${what}`);
  else {
    console.log(`  FAIL ${what}${detail ? ` — ${detail}` : ""}`);
    failures.push(what);
  }
}

function run(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(engine, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
      options.onLine?.(String(chunk));
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
      options.onLine?.(String(chunk));
    });
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

// This machine's conversations directory, standing in for `<userData>/assistant-sessions`.
const conversations = await mkdtemp(path.join(tmpdir(), "cd-conversations-"));

// The app's half of the RPC. Deliberately the same OPS the shipped server answers, written out here rather than
// imported: the shipped one is TypeScript in the renderer's graph, and this script has to run under plain node against
// a real container. What it shares with the shipped one is the wire, which is the thing being proven.
const served = [];
function answer(call) {
  const named = call.path.endsWith("/") ? call.path.slice(0, -1) : call.path;
  if (named === SESSIONS_DIR_IN_IMAGE) {
    if (call.op === "exists") return { kind: "boolean", value: true };
    if (call.op === "createDir") return { kind: "void" };
    if (call.op === "listDir") return { kind: "entries", value: [] };
  }
  const prefix = `${SESSIONS_DIR_IN_IMAGE}/`;
  if (!named.startsWith(prefix)) throw Object.assign(new Error(`refused: ${call.path}`), { code: "refused" });
  const name = named.slice(prefix.length);
  if (name.includes("/") || !name.endsWith(".jsonl")) {
    throw Object.assign(new Error(`refused: ${call.path}`), { code: "refused" });
  }
  return null;
}

const { existsSync, statSync, readFileSync, writeFileSync, appendFileSync, readdirSync, mkdirSync } = await import(
  "node:fs"
);

function perform(call) {
  const early = answer(call);
  if (early) return early;
  const target = path.join(conversations, path.basename(call.path));
  switch (call.op) {
    case "exists":
      return { kind: "boolean", value: existsSync(target) };
    case "fileInfo": {
      if (!existsSync(target)) throw Object.assign(new Error(`ENOENT ${target}`), { code: "not-found" });
      const stat = statSync(target);
      return { kind: "fileInfo", value: { size: stat.size, modifiedMs: stat.mtime.getTime() } };
    }
    case "readTextFile":
      if (!existsSync(target)) throw Object.assign(new Error(`ENOENT ${target}`), { code: "not-found" });
      return { kind: "text", value: readFileSync(target, "utf8") };
    case "readTextLines": {
      if (!existsSync(target)) throw Object.assign(new Error(`ENOENT ${target}`), { code: "not-found" });
      const lines = readFileSync(target, "utf8").split("\n");
      if (lines.at(-1) === "") lines.pop();
      const maxBytes = call.maxBytes ?? Number.POSITIVE_INFINITY;
      const maxLines = call.maxLines ?? Number.POSITIVE_INFINITY;
      const kept = [];
      let bytes = 0;
      for (const line of lines) {
        const cost = Buffer.byteLength(line) + 1;
        if (kept.length >= maxLines || bytes + cost > maxBytes) {
          return { kind: "lines", value: { lines: kept, truncated: true } };
        }
        bytes += cost;
        kept.push(line);
      }
      return { kind: "lines", value: { lines: kept, truncated: false } };
    }
    case "listDir":
      return {
        kind: "entries",
        value: readdirSync(conversations, { withFileTypes: true }).map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
        })),
      };
    case "createDir":
      mkdirSync(target, { recursive: true });
      return { kind: "void" };
    case "writeTextFile":
      if (call.exclusive && existsSync(target)) {
        throw Object.assign(new Error(`EEXIST ${target}`), { code: "exists" });
      }
      writeFileSync(target, call.contents);
      return { kind: "void" };
    case "appendTextFile":
      appendFileSync(target, call.contents);
      return { kind: "void" };
    default:
      throw Object.assign(new Error(`unknown op ${call.op}`), { code: "failed" });
  }
}

// The app DIALS the container, so nothing here listens for the container — this is a client. A tiny server is stood up
// only to hand the socket to `ws`.
async function serve() {
  const { WebSocket } = await import("ws");
  const socket = new WebSocket(`ws://127.0.0.1:${storagePort}`);
  await new Promise((resolve, reject) => {
    socket.on("open", resolve);
    socket.on("error", reject);
  });
  socket.send(JSON.stringify({ type: "hello", token, version: 1 }));
  socket.on("message", (frame) => {
    const request = JSON.parse(frame.toString());
    served.push(request.call);
    try {
      socket.send(JSON.stringify({ id: request.id, ok: true, value: perform(request.call) }));
    } catch (error) {
      socket.send(JSON.stringify({ id: request.id, ok: false, code: error.code ?? "failed", error: error.message }));
    }
  });
  return socket;
}

async function cleanup() {
  await run(["rm", "--force", NAME]);
  await rm(conversations, { recursive: true, force: true });
}

process.on("SIGINT", async () => {
  await cleanup();
  process.exit(130);
});

console.log(`conversations directory on this machine: ${conversations}`);
await run(["rm", "--force", NAME]);

// The image's entrypoint installs the store itself when CD_SESSION_STORAGE_PORT is set, so the probe drives the
// SHIPPED path: `--mode agent` with a storage port, a bridge nobody dials, and a session created over the bridge.
// Simpler and more honest than reaching into the bundle — what runs is exactly what a real session runs.
const bridgePort = storagePort + 1;
const started = await run([
  "run",
  "--detach",
  "--name",
  NAME,
  "--publish",
  `127.0.0.1:${storagePort}:${STORAGE_PORT_IN_IMAGE}`,
  "--publish",
  `127.0.0.1:${bridgePort}:8787`,
  "--env",
  `CD_BRIDGE_TOKEN=${token}`,
  "--env",
  `CD_SESSION_STORAGE_PORT=${STORAGE_PORT_IN_IMAGE}`,
  "--env",
  `CD_SESSION_DIR=${SESSIONS_DIR_IN_IMAGE}`,
  "--env",
  "CD_GATEWAY_URL=http://127.0.0.1:1/v1",
  "--env",
  "CD_MODEL_ID=probe/model",
  image,
  "--mode",
  "agent",
]);
if (started.code !== 0) {
  console.error(`could not start the probe container: ${started.err.trim() || started.out.trim()}`);
  await cleanup();
  process.exit(1);
}

// Give the worker's server time to bind before dialling it.
await new Promise((resolve) => setTimeout(resolve, 1500));

let socket;
try {
  socket = await serve();
} catch (error) {
  const logs = await run(["logs", NAME]);
  console.error(`could not reach the container's conversation store: ${error.message}`);
  console.error(logs.out || logs.err);
  await cleanup();
  process.exit(1);
}
console.log("the app's side of the store is connected");

// One bridge connection is what makes the container build a pi session — which is what makes it touch its storage.
const { WebSocket } = await import("ws");
const bridge = new WebSocket(`ws://127.0.0.1:${bridgePort}`);
await new Promise((resolve, reject) => {
  bridge.on("open", resolve);
  bridge.on("error", reject);
});
const events = [];
bridge.on("message", (frame) => events.push(JSON.parse(frame.toString())));
bridge.send(JSON.stringify({ type: "hello", id: "1", token, protocolVersion: 1 }));

// The session is built during connect, and its first act is to resolve its session directory through the store.
await new Promise((resolve) => setTimeout(resolve, 6000));

// Provoke a real WRITE without a model. pi's own `/import` writes a JSONL into the session directory and then reads it
// back as a conversation — both halves through the store, which is exactly the path a turn's append takes. A turn would
// need a gateway, a provider key and a model to prove the same thing.
const conversation = [
  JSON.stringify({ type: "session", id: "probe-session", version: 3, cwd: "/workspace", timestamp: Date.now() }),
  JSON.stringify({ type: "message", message: { role: "user", content: "imported by the probe", timestamp: 1 } }),
].join("\n");
bridge.send(JSON.stringify({ type: "session_import", id: "2", fileName: "probe.jsonl", contents: conversation }));
await new Promise((resolve) => setTimeout(resolve, 4000));

console.log("\nwhat the container asked this machine for:");
for (const call of served.slice(0, 12)) console.log(`  ${call.op} ${call.path}`);
if (served.length > 12) console.log(`  … and ${served.length - 12} more`);

console.log("\nwhat the container answered:");
for (const event of events) console.log(`  ${event.type}${event.id ? ` id=${event.id}` : ""}${event.success === false ? ` FAILED: ${event.error}` : ""}`);

console.log("\nassertions:");
check("the container asked THIS machine for its conversations", served.length > 0);
check(
  "every path it named was inside the conversations directory",
  served.every((call) => call.path.startsWith(SESSIONS_DIR_IN_IMAGE)),
  served.find((call) => !call.path.startsWith(SESSIONS_DIR_IN_IMAGE))?.path,
);

const wrote = served.filter((call) => call.op === "writeTextFile" || call.op === "appendTextFile");
const landed = await readdir(conversations).catch(() => []);
console.log(`\nwrites received: ${wrote.length}`);
console.log(`files now in the conversations directory: ${landed.join(", ") || "(none)"}`);

check("a conversation was WRITTEN through the store", wrote.length > 0);
check("it landed on this machine", landed.includes("probe.jsonl"), landed.join(", "));
if (landed.includes("probe.jsonl")) {
  const text = await readFile(path.join(conversations, "probe.jsonl"), "utf8");
  check("with the conversation's own contents", text.includes("imported by the probe"));
}
// The read half: pi opens what it just wrote, through the same store.
check(
  "and pi read it back through the store",
  served.some((call) => call.op === "readTextLines" || call.op === "readTextFile"),
  served.map((call) => call.op).join(","),
);

// The claim this whole feature makes: nothing of the history is on the container's own disk.
const inContainer = await run(["exec", NAME, "sh", "-c", `ls -1 ${SESSIONS_DIR_IN_IMAGE} 2>/dev/null | wc -l`]);
const insideCount = Number(inContainer.out.trim() || "0");
check("nothing was written inside the container", insideCount === 0, `${insideCount} file(s) in the container`);

const bridgeReady = events.some((event) => event.type === "ready");
check("the session started with the app's store installed", bridgeReady, JSON.stringify(events.slice(0, 3)));

if (failures.length) {
  const logs = await run(["logs", NAME]);
  console.log(`\ncontainer logs:\n${logs.out || logs.err || "(none — the container's log level drops info)"}`);
}

bridge.close();
socket.close();
await cleanup();

console.log(`\n${failures.length ? `FAILED: ${failures.join("; ")}` : "all assertions passed"}`);
process.exit(failures.length ? 1 : 0);
