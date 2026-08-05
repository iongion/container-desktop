// Drives the plugin-management half of the bridge against a REAL agent container and a REAL published pi
// package, with no app and no WebDriver in the way.
//
// This exists because plugin management is the one part of the bridge that never touches the model: install,
// list, enable, disable, update and remove all run inside the container against pi's own package manager. So
// it can be verified end to end without a provider key — which the `*:live` specs need and this does not.
//
// It starts its own container (mirroring agentRunArgv) on its own volume, so it never disturbs a session the
// app has open, and removes both afterwards unless --keep is passed.
//
//   node support/pi-plugins-probe.mjs
//   node support/pi-plugins-probe.mjs --source npm:pi-simplify --engine podman --keep
//
// Exits non-zero on the first failed check, with the check name.

import { spawnSync } from "node:child_process";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const engine = arg("engine", "podman");
const source = arg("source", "npm:pi-simplify");
const image = arg("image", "container-desktop/pi-agent:6.0.0");
const port = Number(arg("port", "44777"));
const keep = process.argv.includes("--keep");
const token = "probe-token";
const name = "cd-agent-plugins-probe";
const volume = "cd-agent-plugins-probe";
const AGENT_DIR = "/home/agent/.pi/agent";

function engineRun(args, { check = true } = {}) {
  const result = spawnSync(engine, args, { encoding: "utf8" });
  if (check && result.status !== 0) {
    throw new Error(`${engine} ${args.slice(0, 2).join(" ")} failed: ${result.stderr?.trim()}`);
  }
  return (result.stdout ?? "").trim();
}

function cleanup() {
  engineRun(["rm", "-f", name], { check: false });
  engineRun(["volume", "rm", "-f", volume], { check: false });
}

function startContainer() {
  engineRun(["rm", "-f", name], { check: false });
  return engineRun([
    "run",
    "--detach",
    "--name",
    name,
    "--publish",
    `127.0.0.1:${port}:8787`,
    "--volume",
    `${volume}:${AGENT_DIR}${engine === "podman" ? ":U" : ""}`,
    "--env",
    `CD_BRIDGE_TOKEN=${token}`,
    "--env",
    "CD_GATEWAY_URL=http://gateway.invalid:8788/v1",
    "--env",
    "CD_MODEL_ID=probe-model",
    ...(engine === "podman" ? ["--userns", "keep-id:uid=1000,gid=1000"] : []),
    image,
    "--mode",
    "agent",
  ]);
}

const failures = [];
const checks = [];
function check(label, condition, detail) {
  checks.push({ label, ok: Boolean(condition) });
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures.push(label);
  console.log(`  FAIL ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
}

// One socket for the whole run, with a request/response correlation like the app's client.
async function connect() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
        const pending = new Map();
        const progress = [];
        const timer = setTimeout(() => reject(new Error("no ready within 5s")), 5000);
        socket.onerror = () => reject(new Error("socket error"));
        socket.onclose = () => reject(new Error("closed before ready"));
        socket.onopen = () => socket.send(JSON.stringify({ id: "hello", type: "hello", token, protocolVersion: 1 }));
        socket.onmessage = (message) => {
          const event = JSON.parse(String(message.data));
          if (event.type === "plugin_progress") progress.push(event);
          if (event.type === "ready") {
            clearTimeout(timer);
            let next = 0;
            resolve({
              progress,
              send(command) {
                const id = `probe-${(next += 1)}`;
                return new Promise((settle, fail) => {
                  pending.set(id, { settle, fail });
                  socket.send(JSON.stringify({ ...command, id }));
                });
              },
              close: () => socket.close(),
            });
          }
          if (event.type !== "response") return;
          const waiting = pending.get(event.id);
          if (!waiting) return;
          pending.delete(event.id);
          if (event.success) waiting.settle(event.result);
          else waiting.fail(new Error(event.error ?? "command failed"));
        };
      });
    } catch (error) {
      if (attempt === 59) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("unreachable");
}

const named = (resources) => [
  ...resources.commands.map((entry) => entry.name),
  ...resources.skills.map((entry) => entry.name),
  ...resources.prompts.map((entry) => entry.name),
];

async function main() {
  console.log(`starting ${name} on :${port} (${engine}, ${image})`);
  cleanup();
  startContainer();
  let bridge = await connect();

  console.log("\ninstall");
  const empty = await bridge.send({ type: "plugins_list" });
  check("a fresh volume has no configured plugins", empty.configured.length === 0, empty);
  await bridge.send({ type: "plugins_install", source, scope: "user" });
  check("install streamed progress from the container", bridge.progress.length > 0, bridge.progress.length);
  const installed = await bridge.send({ type: "plugins_list" });
  const row = installed.configured.find((entry) => entry.source === source);
  check("the installed package is configured at user scope", row?.scope === "user", installed.configured);
  check("it reports an installed path on disk", Boolean(row?.installedPath), row);
  check("a freshly installed package is enabled", row?.autoload === undefined, row);

  console.log("\ncontributions");
  await bridge.send({ type: "session_reload" });
  const loaded = await bridge.send({ type: "resources_list" });
  const attributed = [...loaded.extensions, ...loaded.commands, ...loaded.skills, ...loaded.prompts].filter(
    (entry) => entry.source === source,
  );
  check("the reload attributed its resources to the package", attributed.length > 0, loaded);

  console.log("\ndisable");
  await bridge.send({ type: "plugins_set_enabled", source, enabled: false, scope: "user" });
  const disabled = await bridge.send({ type: "plugins_list" });
  const disabledRow = disabled.configured.find((entry) => entry.source === source);
  check("disabling keeps the row, with autoload off", disabledRow?.autoload === false, disabledRow);
  check("disabling leaves the files on disk", Boolean(disabledRow?.installedPath), disabledRow);
  const progressBeforeToggle = bridge.progress.length;
  await bridge.send({ type: "session_reload" });
  const afterDisable = await bridge.send({ type: "resources_list" });
  check(
    "a disabled package contributes nothing after a reload",
    afterDisable.extensions.every((entry) => entry.source !== source),
    named(afterDisable),
  );

  console.log("\nre-enable");
  await bridge.send({ type: "plugins_set_enabled", source, enabled: true, scope: "user" });
  await bridge.send({ type: "session_reload" });
  const reEnabled = await bridge.send({ type: "resources_list" });
  check(
    "re-enabling brings the resources back",
    [...reEnabled.extensions, ...reEnabled.commands, ...reEnabled.skills, ...reEnabled.prompts].some(
      (entry) => entry.source === source,
    ),
    named(reEnabled),
  );
  check("no download was needed to toggle", bridge.progress.length === progressBeforeToggle, {
    before: progressBeforeToggle,
    after: bridge.progress.length,
  });

  console.log("\npersistence across a container restart");
  bridge.close();
  engineRun(["rm", "-f", name]);
  startContainer();
  bridge = await connect();
  const afterRestart = await bridge.send({ type: "plugins_list" });
  const survivor = afterRestart.configured.find((entry) => entry.source === source);
  check("the plugin is still configured in the volume", Boolean(survivor), afterRestart.configured);
  check("and still installed on disk", Boolean(survivor?.installedPath), survivor);

  console.log("\nremove");
  await bridge.send({ type: "plugins_remove", source, scope: "user" });
  const removed = await bridge.send({ type: "plugins_list" });
  check("removing drops it from the list", removed.configured.length === 0, removed.configured);
  const gone = engineRun(["exec", name, "ls", `${AGENT_DIR}/packages`], { check: false });
  check("and its install directory is gone", !gone.includes("pi-simplify"), gone);

  console.log("\nerrors");
  let refused;
  try {
    await bridge.send({ type: "plugins_install", source: "npm:this-package-does-not-exist-cd-probe", scope: "user" });
  } catch (error) {
    refused = error.message;
  }
  check("a bad source fails with the container's own error", Boolean(refused), refused);

  bridge.close();
}

try {
  await main();
} catch (error) {
  console.error(`\nprobe aborted: ${error.message}`);
  failures.push(`aborted: ${error.message}`);
} finally {
  if (!keep) cleanup();
  else console.log(`\nleft ${name} and volume ${volume} in place (--keep)`);
}

console.log(`\n${checks.filter((entry) => entry.ok).length}/${checks.length} checks passed`);
if (failures.length > 0) {
  console.error(`failed: ${failures.join(", ")}`);
  process.exit(1);
}
