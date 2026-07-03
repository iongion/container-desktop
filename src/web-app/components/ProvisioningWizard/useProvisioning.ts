// Impure orchestration for the wizard: owns a single renderer-side ProvisioningService and dispatches its
// results into provisioningStore (which stays pure). Mirrors how BuildAdapter is driven from a renderer hook
// — detection + the streamed run happen in-renderer, so there is no IPC/broker.

import { Application } from "@/container-client/Application";
import { ProvisioningService } from "@/container-provisioning/provisioningService";
import { preferredEngine, targetFor } from "@/container-provisioning/targetDefaults";
import type { DetectedProgram, Overall } from "@/container-provisioning/types";
import { createLogger } from "@/logger";
import { useProvisioningStore } from "@/web-app/stores/provisioningStore";

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
