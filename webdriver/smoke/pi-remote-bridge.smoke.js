// A real session on a connection reached over SSH. The pair publishes its bridge on 127.0.0.1 of the machine running
// the ENGINE, so the app's own loopback answers nothing — a session there used to be offered, build its containers and
// never dial. What this proves is the forward: `ssh -NL` opened by the app, a WebSocket riding it, and both the pair and
// the forward gone when the session stops.
//
// Needs a NON-mock app, a REMOTE connection configured in the app, and the agent image present on THAT machine's
// engine (`podman save … | ssh <host> "podman load"`). Nothing here is a defect when it is missing:
//
//   CD_LIVE_REMOTE_SSH_HOST=win11 CD_LIVE_REMOTE_SSH_USER=me CD_LIVE_REMOTE_ENGINE=podman \
//     yarn test:smoke:tauri --spec webdriver/smoke/pi-remote-bridge.smoke.js
//
// No turn is submitted: the gateway inside that machine cannot reach a model server on this one, and what is under
// test is the transport, not inference. NOTHING OF THE USER'S IS TOUCHED — only this session's own pair, removed by
// the last test.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { configureLmStudioProvider, lmStudioStartOptions, loadedModel } from "../support/lmstudioSession.js";
import { appModeReason, firstReason, remoteEngineReason, skipSuite, targetReason } from "../support/prerequisites.js";

const SSH_HOST = process.env.CD_LIVE_REMOTE_SSH_HOST ?? "";
const SSH_USER = process.env.CD_LIVE_REMOTE_SSH_USER ?? "";
const SSH_PORT = Number(process.env.CD_LIVE_REMOTE_SSH_PORT ?? "22");
const ENGINE = process.env.CD_LIVE_REMOTE_ENGINE ?? "podman";
const APP_VERSION = process.env.CD_LIVE_APP_VERSION ?? "6.0.0";
const AGENT_IMAGE = `container-desktop/pi-agent:${APP_VERSION}`;
// The workspace is a path on THAT machine: a remote engine mounts from its own filesystem, and `resolveGuestPath` is
// deliberately the identity there.
const REMOTE_WORKSPACE = process.env.CD_LIVE_REMOTE_WORKSPACE ?? "C:\\Users\\Public\\cd-assistant-ws";
const TARGET = { id: SSH_HOST || "remote", ssh: { host: SSH_HOST, port: SSH_PORT, user: SSH_USER } };

let sessionSpec = {};
let started = {};
let localPort = 0;

// The harness wipes its user-data dir at the start of every run, so the connection under test is written HERE, after
// the wipe, in the shape the app's own builder produces for an SSH remote (`buildRemoteConnectionsFromEnv`). Only the
// engine, the host kind and the scope differ from that template — everything else the app fills in itself.
function seedRemoteConnection() {
  const userData =
    process.env.CONTAINER_DESKTOP_USER_DATA_DIR ?? path.join(process.cwd(), "webdriver", ".e2e-user-data");
  const file = path.join(userData, "user-settings.json");
  const settings = JSON.parse(readFileSync(file, "utf8"));
  const id = `system-env.${SSH_HOST}.${ENGINE}`;
  settings.connections = [
    {
      name: `${SSH_HOST} (${ENGINE})`,
      connectionId: "",
      engine: ENGINE,
      host: `${ENGINE}.remote`,
      id,
      label: `${SSH_HOST} (${ENGINE})`,
      description: `Remote ${ENGINE} over SSH (${SSH_HOST})`,
      settings: {
        api: { baseURL: "http://d", connection: { uri: "", relay: "" }, autoStart: true },
        // Given explicitly when the operator knows it: the app discovers a program over the remote's own shell, and a
        // Windows remote answers `cmd.exe`, where the POSIX idiom finds nothing ("Program podman was not found").
        program: { name: ENGINE, path: process.env.CD_LIVE_REMOTE_PROGRAM ?? "", version: "" },
        rootfull: false,
        mode: "mode.automatic",
        // The scope IS the ssh config host: it is what the engine commands are run through, and what the bridge
        // forward resolves its credentials from.
        controller: { name: "ssh", path: "", version: "current", scope: SSH_HOST },
      },
      readonly: false,
    },
  ];
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  return id;
}

// Asked over plain ssh, entirely outside the app, so an answer can only be about that machine.
function onRemote(command) {
  const args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-p", String(SSH_PORT)];
  const destination = SSH_USER ? `${SSH_USER}@${SSH_HOST}` : SSH_HOST;
  return execFileSync("ssh", [...args, destination, command], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60000,
  }).trim();
}

function runningOnRemote(name) {
  assert.ok(name, "asked whether an unnamed container is running");
  try {
    return onRemote(`${ENGINE} ps --filter name=${name} --format "{{.Names}}"`).includes(name);
  } catch {
    return false;
  }
}

// The forward, as this machine's own process table sees it. Matched on the port pair rather than on "ssh", so nothing
// else's ssh can be mistaken for it.
function forwardIsUp(port) {
  if (!port) return false;
  try {
    const listed = execFileSync("ps", ["-eo", "args"], { encoding: "utf8", timeout: 10000 });
    return listed.includes(`127.0.0.1:${port}:127.0.0.1:`);
  } catch {
    return false;
  }
}

describe("a real session on a connection reached over SSH", () => {
  before(async function () {
    if (!SSH_HOST) {
      return skipSuite(this, "no remote target — set CD_LIVE_REMOTE_SSH_HOST (and _SSH_USER) to an ssh config host");
    }
    const blocked = await firstReason([
      () => appModeReason("real"),
      () => targetReason(TARGET, ENGINE),
      () => remoteEngineReason(TARGET, ENGINE),
    ]);
    if (blocked) return skipSuite(this, blocked);
    // The image lives in THAT machine's store, and an image built here does not exist there.
    try {
      const images = onRemote(`${ENGINE} images --format "{{.Repository}}:{{.Tag}}"`);
      if (!images.includes(AGENT_IMAGE)) {
        return skipSuite(
          this,
          `${AGENT_IMAGE} is not on ${SSH_HOST} — ship it with \`${ENGINE} save ${AGENT_IMAGE} | ssh ${SSH_HOST} "${ENGINE} load"\``,
        );
      }
    } catch (error) {
      return skipSuite(this, `could not read ${SSH_HOST}'s images: ${error}`);
    }
    // A model only has to be pickable: no turn is submitted, so nothing dials it.
    const model = await loadedModel();
    if (!model) return skipSuite(this, "LM Studio has nothing loaded — the start form needs a model to pick");

    // Written before the renderer reads it, then reloaded so the app's bootstrap picks the connection up the same way
    // it picks up one the user configured.
    seedRemoteConnection();
    await browser.execute(() => {
      window.location.reload();
    });
    // The renderer blocks on window.Preloaded and then boots; navigating into that window loses the hash and the
    // screen never mounts. The dev store seam is published at the end of bootstrap, so it is what "back" means.
    await browser.waitUntil(
      async () =>
        await browser.execute(() => !!window.__cdCodingAgentStore && !!window.MessageBus && !!window.AI).catch(() => false),
      { timeout: 90000, interval: 1000, timeoutMsg: "the renderer never came back after the reload" },
    );
    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    await $('[data-screen="ai.assistant"]').waitForExist({
      timeout: 45000,
      timeoutMsg: "the Assistant screen never mounted",
    });

    // A connection the app knows about is not a connection it has CONNECTED: the app brings one up on demand, so this
    // asks for it the same way the header's connection manager does. Never fatal — an SSH host that refuses is the
    // operator's environment, and the wait below then reports it as a skip.
    await browser.executeAsync(
      (id, done) => {
        window.MessageBus.invoke("resource:ensure-connected", { connectionId: id }).then(
          () => done(true),
          (failure) => done(String(failure)),
        );
      },
      `system-env.${SSH_HOST}.${ENGINE}`,
    );

    // The app's OWN list of connections, and only a remote one will do. A configured-but-not-started connection is
    // the operator's state, so it skips rather than fails.
    let connections = [];
    const remoteConnection = async () => {
      const found = await browser.executeAsync((done) => {
        window.AI.runEngineOp({ op: "listConnections", args: {} }).then(
          (result) => done(result),
          (failure) => done({ ok: false, reason: String(failure) }),
        );
      });
      connections = found.ok ? found.value : [];
      return connections.find(
        (entry) => entry.running && entry.engine === ENGINE && `${entry.id} ${entry.name}`.includes(SSH_HOST),
      );
    };
    const target = await browser
      .waitUntil(async () => await remoteConnection(), { timeout: 60000, interval: 3000 })
      .then(
        (found) => found,
        () => undefined,
      );
    if (!target) {
      return skipSuite(
        this,
        `no running ${ENGINE} connection for ${SSH_HOST} in the app (saw ${JSON.stringify(connections)}) — configure one`,
      );
    }

    // A folder on the REMOTE, made there, because that is the filesystem its engine mounts from.
    onRemote(`${ENGINE} version > NUL 2>&1 || true`);
    configureLmStudioProvider(model.id);
    started = await browser.executeAsync((options, done) => {
      const read = () => {
        const state = window.__cdCodingAgentStore.getState();
        return {
          status: state.status,
          reason: state.error ?? "",
          log: state.startLog.join(" | "),
          spec: state.spec ?? {},
          localPort: state.bridgeTunnel?.localPort ?? 0,
        };
      };
      window.__cdCodingAgentStore
        .getState()
        .start(options)
        .then(
          () => done(read()),
          (failure) => done({ ...read(), reason: String(failure) }),
        );
    }, {
      ...lmStudioStartOptions({
        connectionId: target.id,
        workspacePath: REMOTE_WORKSPACE,
        model: model.id,
        appVersion: APP_VERSION,
      }),
      scope: SSH_HOST,
    });
    sessionSpec = started.spec ?? {};
    localPort = started.localPort;
  });

  // A safety net only: the last test stops the session, because what it asserts happens after the stop.
  after(async () => {
    if (!sessionSpec.agentContainerName || !runningOnRemote(sessionSpec.agentContainerName)) return;
    await browser.executeAsync((done) => {
      window.__cdCodingAgentStore
        .getState()
        .stop()
        .then(
          () => done(true),
          () => done(false),
        );
    });
  });

  it("dials the pair through a forward it opened on this machine", () => {
    assert.equal(started.status, "ready", `the session did not become ready: ${started.reason} [${started.log}]`);
    // The port the client dialled is a LOCAL one the app chose, not the port the pair published.
    assert.ok(localPort > 0, "the session reported no forward");
    assert.notEqual(localPort, sessionSpec.hostPort, "the app dialled the published port instead of the forward");
    assert.ok(forwardIsUp(localPort), `no ssh forward for 127.0.0.1:${localPort} in this machine's process table`);
  });

  it("built the pair on the REMOTE machine, not on this one", () => {
    assert.ok(runningOnRemote(sessionSpec.agentContainerName), `${sessionSpec.agentContainerName} is not on ${SSH_HOST}`);
    assert.ok(
      runningOnRemote(sessionSpec.gatewayContainerName),
      `${sessionSpec.gatewayContainerName} is not on ${SSH_HOST}`,
    );
  });

  it("takes the forward down with the session, and the pair with it", async () => {
    await browser.executeAsync((done) => {
      window.__cdCodingAgentStore
        .getState()
        .stop()
        .then(
          () => done(true),
          () => done(false),
        );
    });

    assert.equal(runningOnRemote(sessionSpec.agentContainerName), false, "the agent container is still on the remote");
    assert.equal(runningOnRemote(sessionSpec.gatewayContainerName), false, "the gateway is still on the remote");
    // A forward left running holds a local port for the rest of the app's life, and the next session picks another —
    // so the leak is invisible until the ports run out.
    assert.equal(forwardIsUp(localPort), false, `the ssh forward for 127.0.0.1:${localPort} outlived its session`);
  });
});
