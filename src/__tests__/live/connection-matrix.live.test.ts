import { beforeAll, describe, expect, it } from "vitest";
import { installRealCommand } from "@/__tests__/setup/headless";
import { createConnectorBy } from "@/container-client/connection";
import { runSSHPreflight } from "@/container-client/diagnostics/ssh-preflight";
import { createComposedHostClient } from "@/container-client/runtimes/registry";
import { ContainerEngine, ContainerEngineHost } from "@/container-client/types/engine";
import { isConfigured, loadTestTargets, selectTargets, type TestTarget } from "./targets";

// Real connectivity matrix against the owner's machines. Native hosts get a full /_ping + container
// list; SSH remotes are checked end-to-end by the bounded pre-flight; scoped hosts (WSL/LIMA/vendor)
// go through the real getAvailability detection. Unconfigured combos are skipped loudly — never
// silently passed.
const targets = selectTargets(loadTestTargets(), process.env.CONTAINER_DESKTOP_TEST_TARGETS);

const engineOf = (host: ContainerEngineHost) =>
  host.startsWith("podman") ? ContainerEngine.PODMAN : ContainerEngine.DOCKER;
const isNative = (host: ContainerEngineHost) =>
  host === ContainerEngineHost.PODMAN_NATIVE || host === ContainerEngineHost.DOCKER_NATIVE;
const isRemote = (host: ContainerEngineHost) =>
  host === ContainerEngineHost.PODMAN_REMOTE || host === ContainerEngineHost.DOCKER_REMOTE;
const scopeFor = (target: TestTarget, host: ContainerEngineHost) =>
  host.includes("wsl") ? target.wslDistro : host.includes("lima") ? target.limaInstance : undefined;

const report = (obj: unknown) => JSON.stringify(obj);

if (targets.length === 0) {
  describe("live connection matrix", () => {
    it.skip("no targets configured — copy src/__tests__/live/targets.example.env to targets.env (or set CONTAINER_DESKTOP_TEST_TARGETS)", () => {});
  });
} else {
  beforeAll(async () => {
    await installRealCommand();
  });

  console.warn(
    `[live] running ${targets.length} target(s): ${targets.map((t) => `${t.id}[${t.hosts.length} hosts]`).join(", ")}`,
  );

  for (const target of targets) {
    describe(`live: ${target.id} (${target.os})`, () => {
      for (const host of target.hosts) {
        const engine = engineOf(host);

        it(`${host} is reachable`, async (ctx) => {
          if (!isConfigured(target, host)) {
            ctx.skip();
            return;
          }

          // SSH remote: the bounded pre-flight connects and checks the remote engine end-to-end.
          if (isRemote(host)) {
            if (!target.ssh) {
              console.warn(`[live] ${target.id}/${host}: skipped — no SSH config`);
              ctx.skip();
              return;
            }
            const result = await runSSHPreflight(
              {
                hostName: target.ssh.host,
                port: target.ssh.port,
                user: target.ssh.user,
                identityFile: target.ssh.keyPath,
              },
              { osType: target.os, engineProgram: engine },
            );
            expect(result.ok, report(result.steps)).toBe(true);
            return;
          }

          const connector = await createConnectorBy(target.os, engine, host);
          const client = await createComposedHostClient(connector, target.os);
          const settings = structuredClone(connector.settings);

          // Native: point the driver at the configured socket and ping + list.
          if (isNative(host)) {
            const socket = target.sockets?.[engine];
            if (!socket) {
              console.warn(`[live] ${target.id}/${host}: skipped — no ${engine} socket configured`);
              ctx.skip();
              return;
            }
            settings.mode = "mode.manual";
            settings.api.connection.uri = `unix://${socket}`;
            await client.setSettings(settings);

            const ping = await client.isApiRunning();
            expect(ping.success, `/_ping failed: ${ping.details}`).toBe(true);

            const driver = await client.getApiDriver();
            const containers = await driver.request({ method: "GET", url: "/containers/json", timeout: 5000 });
            expect(Array.isArray(containers.data)).toBe(true);
            return;
          }

          // Scoped (WSL / LIMA / vendor machine): run the real availability detection for the scope.
          const scope = scopeFor(target, host);
          if (scope && settings.controller) {
            settings.controller.scope = scope;
          }
          await client.setSettings(settings);
          const availability = await client.getAvailability();
          expect(availability.api, report(availability.report)).toBe(true);
        });
      }
    });
  }
}
