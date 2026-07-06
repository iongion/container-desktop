// Orchestration glue: dependency-free (no Application) so the podman dialect can call it directly with
// host.getApiDriver(), the same way it calls compose-rest. The ONLY host coupling is an injected async
// `resolvePath` (host.resolveGuestPath), which the caller supplies — keeping this pure/testable.

import type { AxiosInstance } from "axios";

import { applyPlan } from "@/container-client/adapters/compose-rest";
import { translate } from "./translate";
import type { ComposeChangeSummary, ComposeProjectModel, ComposeUpOptions } from "./types";

export interface OrchestrateDeps {
  /** Translate a client-absolute host path to the path the engine sees (guest/WSL/Lima); identity on Native/SSH. */
  resolvePath: (localPath: string) => Promise<string>;
}

/** Make bind-mount sources absolute against the compose-file dir, then guest-translate them. */
export async function resolvePaths(
  model: ComposeProjectModel,
  resolvePath: OrchestrateDeps["resolvePath"],
): Promise<ComposeProjectModel> {
  const services = await Promise.all(
    model.services.map(async (service) => ({
      ...service,
      mounts: await Promise.all(
        service.mounts.map(async (mount) => {
          if (mount.type !== "bind" || !mount.source) return mount;
          const absolute = await Path.resolve(model.projectDir, mount.source);
          return { ...mount, source: await resolvePath(absolute) };
        }),
      ),
    })),
  );
  return { ...model, services };
}

/** resolve paths → translate → reconcile. Shared by the renderer adapter and the podman dialect. */
export async function composeUp(
  driver: AxiosInstance,
  model: ComposeProjectModel,
  opts: ComposeUpOptions,
  deps: OrchestrateDeps,
): Promise<ComposeChangeSummary> {
  const resolved = await resolvePaths(model, deps.resolvePath);
  const plan = translate(resolved, { podMode: opts.podMode });
  return applyPlan(driver, plan, opts);
}
