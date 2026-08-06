// Impure orchestration for the wizard: owns a single renderer-side ProvisioningService and dispatches its
// results into provisioningStore (which stays pure). Mirrors how BuildAdapter is driven from a renderer hook
// — detection + the streamed run happen in-renderer, so there is no IPC/broker.

import { Application } from "@/container-client/Application";
import type { ContainerEngine } from "@/container-client/types/engine";
import { ProvisioningService } from "@/container-provisioning/provisioningService";
import { preferredEngine, targetFor } from "@/container-provisioning/targetDefaults";
import type { DetectedProgram, Overall } from "@/container-provisioning/types";
import { createLogger } from "@/logger";
import { getHostRuntime } from "@/platform/provider";
import { connectedConnections } from "@/web-app/components/ConnectionSelect.logic";
import { useAppStore } from "@/web-app/stores/appStore";
import { writeDefaultSession } from "@/web-app/stores/codingAgent";
import { useProvisioningStore } from "@/web-app/stores/provisioningStore";
import { useResourceStore } from "@/web-app/stores/resourceStore";

const logger = createLogger("web.provisioning");

let singleton: ProvisioningService | undefined;
function service(): ProvisioningService {
  if (!singleton) {
    singleton = new ProvisioningService(Application.getInstance().getOsType());
  }
  return singleton;
}

// Probe the host for engines + transports and store the report. The system-check step guards against
// re-running, so this is effectively once per wizard session unless reset.
export async function runDetection(onResult?: (program: DetectedProgram) => void) {
  const report = await service().detect(onResult);
  const store = useProvisioningStore.getState();
  store.setDetection(report);
  // Default the target from the recommended engine so the downstream steps (review/execute) always have
  // one, even if the user skips the engine step. The engine step lets them change it.
  if (!store.target) {
    store.setTarget(targetFor(preferredEngine(report), report));
  }
  return report;
}

// Drive the prepared plan, folding each StepEvent into the wizard run state as it streams. Returns the
// terminal overall status ("done" | "failed").
export async function runPlan(): Promise<Overall> {
  const plan = useProvisioningStore.getState().plan;
  if (!plan) {
    logger.warn("runPlan called with no prepared plan");
    return "failed";
  }
  return service().run(plan, (event) => useProvisioningStore.getState().applyEvent(event));
}

// Cancel an in-flight run: kill the active command and mark the run canceled so the UI can reflect it.
export function cancelRun(): void {
  service().cancel();
  useProvisioningStore.getState().markCanceled();
}

// Write a minimal AI default session config for the first connected engine matching the provisioned target.
// The launcher picks it up on the next `refreshLaunchers` and offers a "Start" row. Returns the connection id
// it configured, or undefined when no matching connection was found (the engine isn't connected yet) or when
// there is no folder to mount.
export async function configureAssistantOnEngine(engine: ContainerEngine): Promise<string | undefined> {
  const connections = connectedConnections(
    useAppStore.getState().connections,
    useResourceStore.getState().activeRuntime,
    (c) => c.engine === engine,
  );
  const connection = connections[0];
  if (!connection) {
    // Declining is a legitimate outcome — the wizard provisions an engine, it does not create the connection that
    // reaches it — but it must never be a silent one, or the checkbox reads as done when nothing happened.
    logger.warn(
      "not configuring the assistant: no connected %s connection among %o",
      engine,
      useAppStore.getState().connections.map((c) => ({ id: c.id, engine: c.engine })),
    );
    return undefined;
  }

  const settings = useAppStore.getState().userSettings.ai;
  if (settings?.defaultSessions?.[connection.id]) return connection.id;

  // The session mounts this folder as `<path>:/workspace`, handed to the engine as argv with no shell in between,
  // so it has to be a real absolute path — a `~` arrives unexpanded and is read as a volume NAME, which the engine
  // refuses. When the user has not answered the workspace question yet, their home directory is the one folder
  // certain to be there.
  const workspacePath = settings?.workspaceRoot || (await getHostRuntime().platform.getHomeDir());
  if (!workspacePath) return undefined;

  await writeDefaultSession(connection.id, { workspacePath });
  return connection.id;
}
