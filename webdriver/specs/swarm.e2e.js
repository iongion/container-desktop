// Real Docker Swarm end-to-end against a LOCAL sandbox, driven INSIDE the shell over W3C WebDriver. Replaces
// the deleted Vitest suite: the assertions are unchanged, but the engine calls now go through the running
// shell's own ports (Rust under Tauri, Go under Wails) rather than a Node executor.
//
// Swarm is Docker-only. Point the target's DOCKER_SOCKET at the disposable dind sandbox
// (support/swarm-sandbox.sh up | up-multi), NEVER your primary daemon. Needs a NON-mock app:
//   support/swarm-sandbox.sh up
//   CONTAINER_DESKTOP_MOCK= CONTAINER_DESKTOP_TEST_TARGETS=swarm yarn test:e2e:tauri --spec webdriver/specs/swarm.e2e.js
import { selectLiveTargets, toProbeTarget } from "../support/liveTargets.js";

const DOCKER = "docker";
const DOCKER_NATIVE = "docker.native";

const target = selectLiveTargets(process.env.CONTAINER_DESKTOP_TEST_TARGETS).find(
  (entry) => entry.hosts?.includes(DOCKER_NATIVE) && entry.sockets?.[DOCKER],
);

if (!target) {
  describe("swarm live", () => {
    it("has no configured docker.native swarm target", function () {
      console.warn(
        "[live] no configured docker.native swarm target — set CDT_TARGET_<ID>_DOCKER_SOCKET to a sandbox socket (support/swarm-sandbox.sh up)",
      );
      this.skip();
    });
  });
} else {
  const probeTarget = toProbeTarget(target, DOCKER);

  describe("swarm live: lifecycle + graceful non-swarm", () => {
    let observed;

    before(async () => {
      await browser.pause(4000);
      await browser.waitUntil(
        async () => browser.execute(() => typeof window.__cdLiveProbe?.swarmLifecycle === "function"),
        {
          timeout: 30000,
          interval: 500,
          timeoutMsg: "window.__cdLiveProbe never appeared — is this a dev build? (the probe is DEV-gated)",
        },
      );
      observed = await browser.execute(
        async (t, engine, host) => window.__cdLiveProbe.swarmLifecycle(t, engine, host),
        probeTarget,
        DOCKER,
        DOCKER_NATIVE,
      );
    });

    it("maps the non-swarm 503 to empty/undefined (no throw)", () => {
      expect(observed.nonSwarm.inspect).toBe(null);
      expect(observed.nonSwarm.services).toEqual([]);
      expect(observed.nonSwarm.nodes).toEqual([]);
    });

    it("init forms a swarm, inspect reflects it, leave dissolves it", () => {
      expect(observed.initialized).toBe(true);
      expect(observed.formedId).toBeTruthy();
      expect(observed.left).toBe(true);
      expect(observed.afterLeave).toBe(null);
    });
  });

  describe("swarm live: services / stacks / secrets / configs (single-node manager)", () => {
    let observed;

    before(async () => {
      observed = await browser.execute(
        async (t, engine, host) => window.__cdLiveProbe.swarmManager(t, engine, host),
        probeTarget,
        DOCKER,
        DOCKER_NATIVE,
      );
    });

    it("lists at least the local manager node", () => {
      expect(observed.nodeCount).toBeGreaterThanOrEqual(1);
    });

    it("creates → scales → derives a stack → removes a service", () => {
      expect(observed.created).toBe(true);
      expect(observed.serviceId).toBeTruthy();
      expect(observed.scaled).toBe(true);
      expect(observed.stackDerived).toBe(true);
      expect(observed.removed).toBe(true);
    });

    it("round-trips a cluster secret and config", () => {
      expect(observed.secretCreated).toBe(true);
      expect(observed.configCreated).toBe(true);
      expect(observed.secretListed).toBe(true);
      expect(observed.configListed).toBe(true);
    });
  });
}
