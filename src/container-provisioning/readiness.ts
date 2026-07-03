import type { EngineConnectorAvailability } from "@/env/Types";

import type { ReadinessItem, ReadinessReport } from "./types";

const LABELS = {
  host: "Host OS supported",
  program: "Engine program found",
  api: "Engine reachable",
  controller: "Controller running",
  controllerScope: "Scope ready",
} as const;

// Turn the connection availability gate into a readiness checklist. Controller / scope rows only appear
// for scoped hosts (they are undefined for native), so a native connection isn't marked as missing them.
export function evaluateReadiness(a: EngineConnectorAvailability): ReadinessReport {
  const items: ReadinessItem[] = [];
  const push = (key: keyof typeof LABELS, ok: boolean, detail?: string) => {
    items.push({ key, label: LABELS[key], ok, detail: detail ?? (ok ? "ok" : "not ready") });
  };

  push("host", a.host, a.report.host);
  push("program", a.program, a.report.program);
  push("api", a.api, a.report.api);
  if (a.controller !== undefined) {
    push("controller", a.controller, a.report.controller);
  }
  if (a.controllerScope !== undefined) {
    push("controllerScope", a.controllerScope, a.report.controllerScope);
  }

  const ready = a.host && a.program && a.api && a.controller !== false && a.controllerScope !== false;
  return { ready, items };
}
