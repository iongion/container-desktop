// What a SMOKE spec needs from this machine, answered BEFORE it drives anything. Each check reports a REASON it
// cannot run, or nothing at all.
//
// Only the smoke suite (webdriver/smoke/*.smoke.js) asks. Its subject IS the real integration — an engine, a
// machine, an account, a model — so when the subject is absent there is nothing to prove: failing would blame the
// app for the operator's environment, and passing would claim coverage nobody has. It skips, and names what was
// missing. The mock suite (webdriver/specs/*.e2e.js) never asks and must never be gated: nothing outside the app
// is involved there, so a gate could only hide a real defect.
//
// Nothing here asserts, and nothing here starts anything: bringing a VM up, loading a model, standing up a
// sandbox or building an image are the operator's decisions, never a side effect of running a test. A check that
// skips something which WOULD have run is worse than no check, because the report then looks like it ran.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LM_STUDIO_BASE_URL, loadedContextLength } from "./lmstudioSession.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// wdio's beforeSession sets CONTAINER_DESKTOP_MOCK ??= "1" — an explicitly empty value survives it — and that hook
// runs before the framework loads a spec file, so this answer is already final at module scope.
export function appModeReason(want) {
  const mock = !!process.env.CONTAINER_DESKTOP_MOCK;
  if (want === "real" && mock) {
    return "it needs a NON-mock app — run it with CONTAINER_DESKTOP_MOCK= (empty)";
  }
  if (want === "mock" && !mock) {
    return "it needs the mock app — its probe seam exists only in a mock build";
  }
  return undefined;
}

export function envReason(name, why) {
  return process.env[name] ? undefined : `${name} is not set — ${why}`;
}

// `info` rather than `--version`: a binary on PATH answers the version happily with no service running at all, and
// every real call after that fails.
export function engineReason(engine) {
  try {
    execFileSync(engine, ["info"], { stdio: "ignore", timeout: 30000 });
    return undefined;
  } catch {
    return `${engine} is not answering on this machine — start it, or name another with CD_LIVE_ENGINE`;
  }
}

// `image inspect` rather than podman's `image exists`, which docker has not got. An image built for one engine does
// not exist for the other, which is why the engine is half the question.
export function agentImageReason(engine, reference) {
  try {
    execFileSync(engine, ["image", "inspect", reference], { stdio: "ignore", timeout: 60000 });
    return undefined;
  } catch {
    return `${engine} has no ${reference} — build it with \`yarn cli agent-image --engine ${engine}\``;
  }
}

// A container the spec needs ALREADY RUNNING, looked for on either engine — a container on one does not exist on
// the other. Guarded against an empty name on purpose: `--filter name=` matches everything, so an unnamed target
// would read as present.
export function runningContainerReason(name, why) {
  if (!name) return "no container name was given to look for";
  for (const engine of ["podman", "docker"]) {
    try {
      const found = execFileSync(engine, ["ps", "--filter", `name=${name}`, "--format", "{{.Names}}"], {
        encoding: "utf8",
        timeout: 20000,
      }).trim();
      if (found) return undefined;
    } catch {
      // That engine is not answering; the other one may be.
    }
  }
  return `no running container named ${name} on podman or docker — ${why}`;
}

export async function endpointReason(url, what) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(5000) });
    return undefined;
  } catch {
    return `${what} is not answering at ${url}`;
  }
}

// What the server ITSELF reports it loaded. Under the session's own prompt cost a turn cannot be answered at all,
// so such a run proves nothing about the app — and since the fix is a reload, it travels in the reason. The unload
// is not optional: `lms load` fails outright while that model is already resident.
export async function loadedModelReason(model, minimum, recommended = minimum) {
  const origin = LM_STUDIO_BASE_URL.replace(/\/v\d+\/?$/, "");
  const load = `\`lms load ${model} --context-length ${recommended} --yes\``;
  const unreachable = await endpointReason(`${origin}/api/v0/models`, "LM Studio");
  if (unreachable) {
    return `${unreachable} — start it with \`lms server start --cors --bind 0.0.0.0\``;
  }
  const loaded = await loadedContextLength(model);
  if (!loaded) {
    return `LM Studio has no ${model} loaded — ${load}`;
  }
  if (loaded < minimum) {
    return `${model} is loaded at ${loaded}, under the ${minimum} this needs — unload it first, then ${load}`;
  }
  return undefined;
}

// What ~/.ssh/config would dial for a host. A target's SSH_HOST is often an alias (`win11`), which DNS alone
// cannot resolve, so asking ssh itself is the only way to learn the address without authenticating against it.
// Answers `{}` when ssh cannot say — the decision below then stands on what the target declared.
function sshConfigFor(host) {
  try {
    const resolved = execFileSync("ssh", ["-G", host], { encoding: "utf8", timeout: 10000 });
    const read = (field) => resolved.split("\n").find((line) => line.startsWith(`${field} `))?.slice(field.length + 1);
    return { hostname: read("hostname")?.trim(), port: read("port")?.trim() };
  } catch {
    return {};
  }
}

// Which address to dial, decided APART from the lookup — this is where the bug was, so this is what is tested
// (prerequisites.test.ts). A DECLARED non-default port beats ssh's answer, and that is not a detail: the target
// registry defaults an undeclared port to 22, and `ssh -G` also answers 22 for a literal address it has no entry
// for, so trusting ssh dialled the sandbox target's 2222 at 22 — reporting a RUNNING sandbox as unreachable. A
// silent skip is worse than a failure, because the report then looks like the suite ran.
export function dialledDestination(ssh, configured = {}) {
  const declaredPort = Number(ssh.port) || 22;
  const configuredPort = Number(configured.port) || 0;
  return {
    host: configured.hostname || ssh.host,
    port: declaredPort !== 22 ? declaredPort : configuredPort || declaredPort,
  };
}

// Is anything listening? One connect, no handshake and no credential — a VM that is shut off, a laptop that is
// closed and a sandbox that was torn down all answer the same way, which is all this needs to know. Takes either a
// TCP destination or a unix socket path, because a live target names its engine one way and its machine the other.
function listening(destination, timeout = 4000) {
  return new Promise((resolve) => {
    const socket = net.connect(destination);
    const settle = (answer) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}

// The engine on the FAR side of an ssh target. A machine answering on 22 says nothing about the engine it declares:
// win11 boots long before Docker Desktop does, and its CLI answers while the daemon behind it does not — so the
// matrix failed there and blamed the app for a service the operator had not started. Asked over plain ssh, entirely
// outside the app, so it can only ever report the operator's environment. `info` rather than `--version` for the same
// reason the local check uses it: a binary on PATH answers a version happily with no daemon running at all.
export function remoteEngineReason(target, engine) {
  if (!target.ssh?.host || !engine) return undefined;
  const destination = `${target.ssh.user}@${target.ssh.host}`;
  const args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-p", String(target.ssh.port || 22)];
  if (target.ssh.keyPath) args.push("-i", target.ssh.keyPath);
  try {
    execFileSync("ssh", [...args, destination, engine, "info"], { stdio: "ignore", timeout: 60000 });
    return undefined;
  } catch {
    return `${engine} on ${target.id} is not answering — start it there (Docker Desktop / the podman service)`;
  }
}

// A live target's machine, reachable or not. An SSH target is dialled; a native/scoped one IS this machine, so what
// stands in for reachability is the engine socket it named actually being there.
export async function targetReason(target, engine) {
  if (target.ssh?.host) {
    const dialled = dialledDestination(target.ssh, sshConfigFor(target.ssh.host));
    if (!(await listening(dialled))) {
      return `${target.id} is not reachable at ${dialled.host}:${dialled.port} — is the machine up?`;
    }
    return undefined;
  }
  const declared = engine ? target.sockets?.[engine] : undefined;
  if (!declared) return undefined;
  const socketPath = path.resolve(repoRoot, declared.replace(/^unix:\/\//, ""));
  if (!existsSync(socketPath)) {
    return `${target.id}'s ${engine} socket is not there (${declared}) — is the engine, or the sandbox, up?`;
  }
  // The file surviving a teardown is not the service surviving it: a stale socket would otherwise be read as a
  // running engine and fail every call after, which reads like the app's fault.
  if (!(await listening({ path: socketPath }))) {
    return `nothing is listening on ${target.id}'s ${engine} socket (${declared}) — a stale socket file?`;
  }
  return undefined;
}

// The first reason that stands, evaluated in order so the cheapest question is asked first and nothing dials a
// machine whose spec was never going to run.
export async function firstReason(checks) {
  for (const check of checks) {
    const reason = await (typeof check === "function" ? check() : check);
    if (reason) return reason;
  }
  return undefined;
}

// A suite that only announces why it did not run — the idiom connection-matrix and swarm already use: a pending
// test carrying the reason, so the report says SKIPPED with the fix in it, never a silent pass and never a failure
// for something this machine simply has not got.
export function skippedSuite(title, reason) {
  describe(title, () => {
    it(`did not run: ${reason}`, function () {
      console.warn(`[live] SKIP ${title} — ${reason}`);
      this.skip();
    });
  });
}

// The same answer once a suite has started, for a check that has to be awaited (a machine dialled, a model asked).
// Mocha's skip() throws, so this ends the hook where it is called.
export function skipSuite(context, reason) {
  console.warn(`[live] SKIP ${context.test?.parent?.title ?? "suite"} — ${reason}`);
  context.skip();
}
