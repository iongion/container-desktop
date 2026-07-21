import { beforeAll, describe, expect, it } from "vitest";
import { isConfigured, loadTestTargets, selectTargets } from "@/__tests__/live/targets";
import { installRealCommand } from "@/__tests__/setup/headless";
import { SwarmAdapter } from "@/container-client/adapters/swarm";
import { createConnectorBy } from "@/container-client/connection";
import { createComposedHostClient } from "@/container-client/runtimes/registry";
import { ContainerEngine, ContainerEngineHost } from "@/container-client/types/engine";

// Real Docker Swarm end-to-end against a LOCAL sandbox (support/swarm-sandbox.sh up | up-multi) — swarm
// is Docker-only. Point the `swarm` target's DOCKER_SOCKET at the disposable dind sandbox, never your
// primary daemon:  CONTAINER_DESKTOP_TEST_TARGETS=swarm yarn test:live
const targets = selectTargets(loadTestTargets(), process.env.CONTAINER_DESKTOP_TEST_TARGETS);
const target = targets.find(
  (entry) => isConfigured(entry, ContainerEngineHost.DOCKER_NATIVE) && entry.sockets?.[ContainerEngine.DOCKER],
);

if (!target) {
  describe("swarm live", () => {
    it.skip("no configured docker.native swarm target — set CDT_TARGET_<ID>_DOCKER_SOCKET to a sandbox socket (support/swarm-sandbox.sh up)", () => {});
  });
} else {
  const socket = target.sockets?.[ContainerEngine.DOCKER] as string;
  let adapter: SwarmAdapter;

  beforeAll(async () => {
    await installRealCommand();
    const connector = await createConnectorBy(target.os, ContainerEngine.DOCKER, ContainerEngineHost.DOCKER_NATIVE);
    const client = await createComposedHostClient(connector, target.os);
    const settings = structuredClone(connector.settings);
    settings.mode = "mode.manual";
    settings.api.connection.uri = `unix://${socket}`;
    await client.setSettings(settings);
    // Docker hosts advertise extensions.swarm=true (dialect flip); SwarmAdapter gates on that.
    adapter = new SwarmAdapter(client);
  }, 60_000);

  // Idempotent preconditions so tests never depend on incidental sandbox state.
  const ensureManager = async () => {
    if (!(await adapter.inspect())) {
      await adapter.init();
    }
  };
  const ensureNonSwarm = async () => {
    if (await adapter.inspect()) {
      await adapter.leave({ force: true });
    }
  };

  describe("swarm live: lifecycle + graceful non-swarm", () => {
    it("maps the non-swarm 503 to empty/undefined (no throw)", async () => {
      await ensureNonSwarm();
      expect(await adapter.inspect()).toBeUndefined();
      expect(await adapter.listServices()).toEqual([]);
      expect(await adapter.listNodes()).toEqual([]);
    });

    it("init forms a swarm, inspect reflects it, leave dissolves it", async () => {
      await ensureNonSwarm();
      expect(await adapter.init()).toBe(true);
      expect((await adapter.inspect())?.ID).toBeTruthy();
      expect(await adapter.leave({ force: true })).toBe(true);
      expect(await adapter.inspect()).toBeUndefined();
    });
  });

  describe("swarm live: services / stacks / secrets / configs (single-node manager)", () => {
    beforeAll(ensureManager, 30_000);

    it("lists at least the local manager node", async () => {
      expect((await adapter.listNodes()).length).toBeGreaterThanOrEqual(1);
    });

    it("creates → scales → derives a stack → removes a service", async () => {
      const name = "cdtest_web";
      const priorId = (await adapter.listServices()).find((s) => s.Spec?.Name === name)?.ID;
      if (priorId) {
        await adapter.removeService(priorId);
      }
      expect(
        await adapter.createService({
          Name: name,
          Labels: { "com.docker.stack.namespace": "cdtest" },
          TaskTemplate: { ContainerSpec: { Image: "nginx:alpine" } },
          Mode: { Replicated: { Replicas: 1 } },
        }),
      ).toBe(true);
      const service = (await adapter.listServices()).find((s) => s.Spec?.Name === name);
      expect(service?.ID).toBeTruthy();
      expect(await adapter.scaleService(service!.ID, 2)).toBe(true);
      expect((await adapter.listStacks()).some((stack) => stack.Name === "cdtest")).toBe(true);
      expect(await adapter.removeService(service!.ID)).toBe(true);
    });

    it("round-trips a cluster secret and config", async () => {
      const secretName = "cdtest_secret";
      const configName = "cdtest_config";
      const purge = async () => {
        for (const secret of await adapter.listSecrets()) {
          if (secret.Spec?.Name === secretName) {
            await adapter.removeSecret(secret.ID);
          }
        }
        for (const config of await adapter.listConfigs()) {
          if (config.Spec?.Name === configName) {
            await adapter.removeConfig(config.ID);
          }
        }
      };
      await purge();
      expect(await adapter.createSecret({ Name: secretName, Data: "s3cr3t" })).toBe(true);
      expect(await adapter.createConfig({ Name: configName, Data: "cfg-data" })).toBe(true);
      expect((await adapter.listSecrets()).some((s) => s.Spec?.Name === secretName)).toBe(true);
      expect((await adapter.listConfigs()).some((c) => c.Spec?.Name === configName)).toBe(true);
      await purge();
    });
  });
}
