import type { Pod } from "@/env/Types";
import { t } from "@/i18n";
import type { InspectSummaryRow } from "@/web-app/components/InspectSummary";
import { inspectDate, shortId } from "@/web-app/components/inspectSummary.helpers";

// The most important pod facts (echoes the Pods list). Pods are Podman-only, so there is no
// cross-engine reconciliation to do here.
export function buildPodSummary(pod: Pod): InspectSummaryRow[] {
  const rows: InspectSummaryRow[] = [];
  if (pod.Name) {
    rows.push({ key: "name", label: t("Name"), value: pod.Name, copyText: pod.Name });
  }
  if (pod.Status) {
    rows.push({ key: "status", label: t("Status"), value: pod.Status, render: "state" });
  }
  if (typeof pod.NumContainers === "number") {
    rows.push({ key: "containers", label: t("Containers"), value: `${pod.NumContainers}` });
  }
  if (pod.Id) {
    rows.push({ key: "id", label: t("Id"), value: shortId(pod.Id), copyText: pod.Id, mono: true, render: "code" });
  }
  if (pod.NameSpace) {
    rows.push({ key: "namespace", label: t("Namespace"), value: pod.NameSpace });
  }
  if (pod.Created) {
    rows.push({ key: "created", label: t("Created"), value: inspectDate(pod.Created) });
  }
  return rows;
}
