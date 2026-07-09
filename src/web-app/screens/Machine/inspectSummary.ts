import prettyBytes from "pretty-bytes";

import type { PodmanMachine, PodmanMachineInspect } from "@/env/Types";
import { t } from "@/i18n";
import type { InspectSummaryRow } from "@/web-app/components/InspectSummary";
import { inspectDate, yesNo } from "@/web-app/components/inspectSummary.helpers";

// Machines are Podman-only. The detail hook returns a PodmanMachineInspect but seeds from the
// PodmanMachine list item, whose field names differ (nested `Resources.*` + `State` vs top-level
// `CPUs`/`Memory`/`DiskSize` + `Running`) — so read BOTH shapes with fallbacks.
export function buildMachineSummary(machine: PodmanMachineInspect | PodmanMachine): InspectSummaryRow[] {
  const m = machine as Partial<PodmanMachineInspect> & Partial<PodmanMachine>;
  const rows: InspectSummaryRow[] = [];
  if (m.Name) {
    rows.push({ key: "name", label: t("Name"), value: m.Name, copyText: m.Name });
  }
  const state = m.State ?? (m.Running === true ? "running" : m.Running === false ? "stopped" : undefined);
  if (state) {
    rows.push({ key: "state", label: t("State"), value: state, render: "state" });
  }
  const cpus = m.Resources?.CPUs ?? m.CPUs;
  if (cpus) {
    rows.push({ key: "cpus", label: t("CPUs"), value: `${cpus}` });
  }
  const memory = m.Resources?.Memory ?? m.Memory;
  if (memory && !Number.isNaN(Number(memory))) {
    rows.push({ key: "memory", label: t("Memory"), value: prettyBytes(Number(memory)) });
  }
  const disk = m.Resources?.DiskSize ?? m.DiskSize;
  if (disk && !Number.isNaN(Number(disk))) {
    rows.push({ key: "disk", label: t("Disk size"), value: prettyBytes(Number(disk)) });
  }
  if (typeof m.Rootful === "boolean") {
    rows.push({ key: "rootful", label: t("Rootful"), value: yesNo(m.Rootful) });
  }
  if (m.Created) {
    rows.push({ key: "created", label: t("Created"), value: inspectDate(m.Created) });
  }
  if (m.LastUp) {
    rows.push({ key: "lastup", label: t("Last up"), value: inspectDate(m.LastUp) });
  }
  return rows;
}
