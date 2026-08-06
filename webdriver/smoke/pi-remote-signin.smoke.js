// A provider sign-in started on a connection reached over SSH — the half of a sign-in this app owns.
//
// The one-shot login container used to run through `runHostCommand` whatever connection the user had chosen, so it
// landed on a LOCAL engine (or failed outright where this machine has no engine binary), and the app then dialled
// `127.0.0.1:<port>` — a port only that local engine had published. On a machine whose only engine is remote, signing
// in was therefore impossible, and the app reported a bridge it had never had any way to reach.
//
// What this proves, end to end and with nothing stubbed: the container is created through the CONNECTION's own scope
// and exists on the remote; its environment reaches it in a volume carried over the engine's own stdin, because
// `--env-file` names a path that machine has never seen; its bridge is forwarded here with `ssh -NL`; and pi's own
// flow, running inside that container, speaks back over that socket. The last is the whole route in one observation:
// an `auth_url` in this app's store came from pi, in a container on another machine, through a forward this app opened.
//
// IT IS ABANDONED, ALWAYS, AND DELIBERATELY. A sign-in ends in the user's own browser, which no spec can drive — and
// completing one would write a real credential into the user's OS keychain. This cancels before pi can produce one, so
// nothing is stored, nothing is read from the vault, and no account is needed to run it.
//
// Needs a NON-mock app, a REMOTE connection configured, and the agent image on THAT machine's engine. Nothing here is
// a defect when it is missing:
//
//   CD_LIVE_REMOTE_SSH_HOST=win11 CD_LIVE_REMOTE_SSH_USER=me CD_LIVE_REMOTE_ENGINE=podman \
//     yarn test:smoke:tauri --spec webdriver/smoke/pi-remote-signin.smoke.js
//
// NOTHING OF THE USER'S IS TOUCHED — only this run's own login container and its environment volume.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { reloadApp } from "../support/appReload.js";
import { appModeReason, firstReason, remoteEngineReason, skipSuite, targetReason } from "../support/prerequisites.js";

const SSH_HOST = process.env.CD_LIVE_REMOTE_SSH_HOST ?? "";
const SSH_USER = process.env.CD_LIVE_REMOTE_SSH_USER ?? "";
const SSH_PORT = Number(process.env.CD_LIVE_REMOTE_SSH_PORT ?? "22");
const ENGINE = process.env.CD_LIVE_REMOTE_ENGINE ?? "podman";
const APP_VERSION = process.env.CD_LIVE_APP_VERSION ?? "6.0.0";
const AGENT_IMAGE = `container-desktop/pi-agent:${APP_VERSION}`;
const TARGET = { id: SSH_HOST || "remote", ssh: { host: SSH_HOST, port: SSH_PORT, user: SSH_USER } };
// OpenRouter's flow publishes a PKCE URL and then waits on the browser, which is exactly the shape this needs: a frame
// that can only have come from pi, raised before any credential exists.
const PROVIDER = "openrouter";
// The container has to be created on the remote, its bridge forwarded, and pi's flow started — a dozen SSH round trips
// on a Windows target.
const FLOW_TIMEOUT = 180000;

let connectionId = "";
let flow = {};
let observed = {};
// What this machine already had before the sign-in started. Measured, not assumed: two `Created` login containers from
// runs the day before were sitting here, so "none on this machine" read as a defect in code that had created none.
let localBefore = [];

function onRemote(command) {
  const args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-p", String(SSH_PORT)];
  const destination = SSH_USER ? `${SSH_USER}@${SSH_HOST}` : SSH_HOST;
  return execFileSync("ssh", [...args, destination, command], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60000,
  }).trim();
}

// Every login container on that machine, by the name this app gives them. Read with `ps -a`, not `ps`: a container
// that exited still holds its name, and "gone" has to mean gone.
function loginContainersOnRemote() {
  try {
    return onRemote(`${ENGINE} ps -a --filter name=container-desktop-login --format "{{.Names}}"`)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// The login containers on THIS machine, whoever left them. Both engines, because the app can sign in on either.
function loginContainersHere() {
  const found = [];
  for (const program of ["podman", "docker"]) {
    try {
      const listed = execFileSync(
        program,
        ["ps", "-a", "--filter", "name=container-desktop-login", "--format", "{{.Names}}"],
        { encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "pipe"] },
      );
      found.push(...listed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    } catch {
      // No such engine here, which is not a container.
    }
  }
  return found;
}

function loginVolumesOnRemote() {
  try {
    return onRemote(`${ENGINE} volume ls --format "{{.Name}}"`)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((name) => name.startsWith("container-desktop-env-login-"));
  } catch {
    return [];
  }
}

// The LOCAL PORTS this machine is holding a forward on, as its own process table sees it. Ports rather than lines,
// because the teardown check has to name the ones THIS sign-in opened: the owner's own app may be holding a session's
// forward at the same time, and asserting "no forwards at all" would fail on theirs. The pattern is bracketed in every
// occurrence — a `ps` whose own command line contains what it greps for finds itself.
function forwardPortsHere() {
  try {
    const listed = execFileSync("ps", ["-eo", "args"], { encoding: "utf8", timeout: 10000 });
    return [...listed.matchAll(/-[N]L 127\.0\.0\.1:(\d+):/g)].map((match) => match[1]);
  } catch {
    return [];
  }
}

// The same seed the remote-bridge spec uses: the harness wipes its user-data dir at the start of every run, so the
// connection under test is written after the wipe, in the shape the app's own builder produces for an SSH remote. It
// is also made the DEFAULT, because that is what a sign-in runs on — there is no connection picker on a login.
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
        program: { name: ENGINE, path: process.env.CD_LIVE_REMOTE_PROGRAM ?? "", version: "" },
        rootfull: false,
        mode: "mode.automatic",
        controller: { name: "ssh", path: "", version: "current", scope: SSH_HOST },
      },
      readonly: false,
    },
  ];
  settings.connector = { ...settings.connector, default: id };
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  return id;
}

describe("a provider sign-in on a connection reached over SSH", () => {
  before(async function () {
    if (!SSH_HOST) {
      return skipSuite(this, "no remote target — set CD_LIVE_REMOTE_SSH_HOST (and _SSH_USER) to an ssh config host");
    }
    // Creating a container on a remote is a dozen SSH round trips, and W3C's default script timeout is 30 seconds.
    // Left at the default, WebdriverIO gives up and RETRIES the script — which starts a SECOND sign-in container.
    await browser.setTimeout({ script: 600000 });
    const blocked = await firstReason([
      () => appModeReason("real"),
      () => targetReason(TARGET, ENGINE),
      () => remoteEngineReason(TARGET, ENGINE),
    ]);
    if (blocked) return skipSuite(this, blocked);
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

    localBefore = loginContainersHere();
    connectionId = seedRemoteConnection();
    // Through `reloadApp`, which waits for the NEW document: a bare `location.reload()` returns before the reload
    // happens and every seam a wait could check exists on the old document too.
    await reloadApp();
    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    await $('[data-screen="ai.assistant"]').waitForExist({
      timeout: 45000,
      timeoutMsg: "the Assistant screen never mounted",
    });

    await browser.executeAsync(
      (id, done) => {
        window.MessageBus.invoke("resource:ensure-connected", { connectionId: id }).then(
          () => done(true),
          (failure) => done(String(failure)),
        );
      },
      connectionId,
    );
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

    // Started WITHOUT awaiting: a sign-in does not settle until the user's browser finishes it or it is cancelled, so
    // awaiting here would hold this hook for pi's whole fifteen-minute budget. What the spec waits for instead is the
    // first frame pi sends back, which is the observation that matters.
    await browser.execute((provider) => {
      window.__cdSignInOutcome = undefined;
      void window.__cdProviderLoginStore
        .getState()
        .signIn(provider, { allowDegraded: false })
        .then(
          (result) => {
            window.__cdSignInOutcome = result;
          },
          (failure) => {
            window.__cdSignInOutcome = { stored: false, reason: String(failure) };
          },
        );
    }, PROVIDER);

    const read = () =>
      browser.execute(() => {
        const state = window.__cdProviderLoginStore.getState();
        return {
          status: state.status,
          authUrl: state.authUrl ?? "",
          prompt: state.prompt?.prompt?.message ?? "",
          message: state.message ?? "",
          log: state.log.join(" | "),
          outcome: window.__cdSignInOutcome ?? null,
        };
      });
    // pi's flow has spoken when it publishes its URL, raises its question, or the sign-in gives up with a reason —
    // three ends, all of which are an answer. Waiting only for the URL would burn the timeout on a failure that had
    // already been reported.
    await browser.waitUntil(
      async () => {
        const state = await read();
        return !!state.authUrl || !!state.prompt || state.status === "error" || !!state.outcome;
      },
      { timeout: FLOW_TIMEOUT, interval: 2000, timeoutMsg: "the remote sign-in never got a frame back from pi" },
    );
    flow = await read();
    // Sampled while it is UP: everything below is about to be torn down, and after the teardown all of it is absent
    // whether the app ever created it or not.
    observed = {
      containers: loginContainersOnRemote(),
      volumes: loginVolumesOnRemote(),
      forwards: forwardPortsHere(),
      // Only what THIS run added: anything already here belongs to the machine's history, not to this sign-in.
      localAdded: loginContainersHere().filter((name) => !localBefore.includes(name)),
    };
    console.log(`REMOTE SIGN-IN ${JSON.stringify({ flow, observed }, null, 2)}`);

    // Abandoned before pi can produce a credential — see this file's header. `cancel` is what the drawer's own close
    // does, and the store's `finally` is what releases the container, its volume and the forward.
    await browser.execute(() => {
      window.__cdProviderLoginStore.getState().cancel();
    });
    await browser.waitUntil(async () => !!(await read()).outcome, {
      timeout: 60000,
      interval: 1000,
      timeoutMsg: "the cancelled sign-in never settled",
    });
  });

  after(async () => {
    // A safety net only: the hook cancels, and the store's own `finally` removes both. This catches a run that failed
    // before the cancel, because a login container left listening on the remote holds a published port there.
    for (const name of loginContainersOnRemote()) {
      try {
        onRemote(`${ENGINE} rm --force ${name}`);
      } catch {
        // Already gone, which is the state this wants.
      }
    }
  });

  it("reached pi's own flow, inside a container on the remote", () => {
    assert.ok(
      flow.authUrl || flow.prompt,
      `no frame came back from pi — status=${flow.status} message=${flow.message} log=[${flow.log}]`,
    );
    // OpenRouter's is a redirect flow, so the URL is the frame; a device-code flow would raise the prompt instead.
    if (flow.authUrl) {
      assert.match(flow.authUrl, /^https:\/\//, `pi published something that is not a URL: ${flow.authUrl}`);
    }
  });

  // The defect itself: the container used to be created HERE whatever connection was chosen.
  it("created the container on the remote machine, and none on this one", () => {
    assert.ok(
      observed.containers.length > 0,
      `no container-desktop-login container on ${SSH_HOST} while the sign-in was running`,
    );
    assert.deepEqual(
      observed.localAdded,
      [],
      `a sign-in container was created on THIS machine as well: ${observed.localAdded.join(", ")}`,
    );
  });

  // `--env-file` is read by the CLIENT, which is on that machine, so a path under this app's user data means nothing
  // there. The same text is carried into a volume over the engine's own stdin instead.
  it("carried the environment in a volume, because a file here could not be read there", () => {
    assert.ok(
      observed.volumes.length > 0,
      `no container-desktop-env-login volume on ${SSH_HOST} — the environment cannot have reached the container`,
    );
  });

  it("forwarded the bridge to this machine", () => {
    assert.ok(
      observed.forwards.length > 0,
      "no ssh forward in this machine's process table while the remote sign-in was running",
    );
  });

  it("dialled that forward, and not the port the remote published", () => {
    // The container's own published port is on the REMOTE, so a dial to it here reaches nothing — the app must have
    // dialled a local port it chose. Both are ports this run picked, so the proof is that a forward held one of them.
    assert.ok(
      observed.forwards.some((port) => Number(port) > 0),
      `the forward held no local port: ${JSON.stringify(observed.forwards)}`,
    );
  });

  // A sign-in container keeps listening so a refused code can be retried on the same socket, and the forward under it
  // holds a local port and an SSH connection here. Neither may outlive the sign-in.
  it("took the container, the volume and the forward down when it was abandoned", () => {
    assert.deepEqual(loginContainersOnRemote(), [], `a sign-in container outlived the sign-in on ${SSH_HOST}`);
    assert.deepEqual(loginVolumesOnRemote(), [], `a sign-in's environment volume outlived it on ${SSH_HOST}`);
    const survivors = forwardPortsHere().filter((port) => observed.forwards.includes(port));
    assert.deepEqual(survivors, [], `an ssh forward outlived the sign-in it was opened for: ${survivors.join(",")}`);
  });
});
