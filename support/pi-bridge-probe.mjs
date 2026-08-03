// Talks to a running pi agent container's bridge directly, with no app and no WebDriver in the way.
//
// This is the reliable way to verify the CONTAINER half of the bridge — the host's event mapping, an
// extension's output, whether a turn runs at all — because it isolates it from the renderer and from
// WebKitWebDriver, whose session can stop answering script commands during a long live run.
//
// Usage, against a session the app already started:
//
//   podman ps --filter name=cd-agent- --format '{{.Names}} {{.Ports}}'
//   node support/pi-bridge-probe.mjs --port 44510 --suffix 2ca2e2cd --prompt "Say hello."
//
// The suffix is the session id in the container name; the token is read from that session's env file. Pass
// --seconds to listen longer, and --filter to print only the event types you care about:
//
//   node support/pi-bridge-probe.mjs --port 44510 --suffix 2ca2e2cd --filter entry,custom_message
//
// NOTE: the app removes the container when the session stops, and a spec that seeds an extension into the
// `cd-agent-plugins` volume usually deletes it again in its cleanup — the volume is mounted live, so probe
// while the session is still up if the extension matters.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const port = arg("port");
const suffix = arg("suffix");
const prompt = arg("prompt");
const seconds = Number(arg("seconds", "30"));
const filter = arg("filter");

if (!port || !suffix) {
  console.error("need --port <hostPort> and --suffix <sessionSuffix>");
  process.exit(2);
}

const envFile = path.join(homedir(), ".local/share/container-desktop/agent", `${suffix}.env`);
const token = readFileSync(envFile, "utf8")
  .split("\n")
  .find((line) => line.startsWith("CD_BRIDGE_TOKEN="))
  ?.slice("CD_BRIDGE_TOKEN=".length)
  .trim();

if (!token) {
  console.error(`no CD_BRIDGE_TOKEN in ${envFile}`);
  process.exit(2);
}

const wanted = filter ? new Set(filter.split(",").map((value) => value.trim())) : undefined;
const events = [];
const socket = new WebSocket(`ws://127.0.0.1:${port}/`);

socket.onopen = () => socket.send(JSON.stringify({ id: "hello-1", type: "hello", token, protocolVersion: 1 }));

socket.onmessage = (message) => {
  const event = JSON.parse(String(message.data));
  events.push(event);
  if (!wanted || wanted.has(event.type)) console.log(JSON.stringify(event));
  // Prompting only after `ready` keeps the handshake honest: an unauthenticated peer gets nothing.
  if (event.type === "ready" && prompt) {
    socket.send(JSON.stringify({ id: "prompt-1", type: "prompt", text: prompt }));
  }
};

socket.onerror = () => console.error("bridge socket error");
socket.onclose = (event) => console.error(`bridge closed code=${event.code} reason=${event.reason}`);

setTimeout(() => {
  const counts = {};
  for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1;
  console.log(`\nevent counts after ${seconds}s: ${JSON.stringify(counts)}`);
  process.exit(0);
}, seconds * 1000);
