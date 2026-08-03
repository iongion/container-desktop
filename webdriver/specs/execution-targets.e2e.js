// The worker-execution-target matrix against REAL engines, driven INSIDE the shell over W3C WebDriver. Replaces
// the deleted Vitest live arm, which needed a Node executor; the probe runs on this shell's SHIPPED adapters
// (engineOps + connectionExec + workspaceAccess), so it proves the Rust/Go off-host path rather than a parallel one.
//
// The checks themselves live in src/__tests__/support/executionTargetMatrix.ts and are shared with the hermetic
// mock arm (platform/tests/capabilities/executionTargets.mock.test.ts), so the two arms cannot drift: the probe
// returns that verification's failures and this spec asserts the list is empty.
//
// Needs a NON-mock app plus a reachable engine:
//   CONTAINER_DESKTOP_MOCK= yarn test:e2e:tauri --spec webdriver/specs/execution-targets.e2e.js
import { engineOfHost, isNativeHost, selectLiveTargets } from "../support/liveTargets.js";

const SANDBOX_LABEL = "container-desktop.ai.sandbox";
const imageFor = (engine) => (engine === "podman" ? "docker.io/library/alpine:3" : "alpine:3");

const target = selectLiveTargets(process.env.CONTAINER_DESKTOP_TEST_TARGETS).find((entry) =>
  (entry.hosts ?? []).some((host) => isNativeHost(host)),
);

if (!target) {
  describe("execution targets — live", () => {
    it("has no configured native target", function () {
      console.warn("[live] no configured native target — set CDT_TARGET_<ID>_HOSTS to include podman.native or docker.native");
      this.skip();
    });
  });
} else {
  const host = (target.hosts ?? []).find((entry) => isNativeHost(entry));
  const engine = engineOfHost(host);

  describe(`execution targets — live (${engine} on ${target.id})`, () => {
    before(async () => {
      await browser.pause(4000);
      await browser.waitUntil(
        async () => browser.execute(() => typeof window.__cdExecutionMatrixProbe === "function"),
        {
          timeout: 30000,
          interval: 500,
          timeoutMsg:
            "window.__cdExecutionMatrixProbe never appeared — needs a dev build with a reachable connection (engineOps + connectionExec + workspaceAccess must all be bound)",
        },
      );
    });

    it("each worker runs on its own target, then the run's sandboxes are removed", async () => {
      const failures = await browser.execute(
        async (spec) => window.__cdExecutionMatrixProbe(spec),
        {
          connectionId: `${engine}-native`,
          image: imageFor(engine),
          supportsRemote: Boolean(target.ssh),
          supportsEngine: true,
          sandboxLabel: SANDBOX_LABEL,
        },
      );
      expect(failures, `matrix failures:\n${(failures || []).join("\n")}`).toEqual([]);
    });
  });
}
