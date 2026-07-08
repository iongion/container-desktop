import type { SwarmConfig, SwarmNode, SwarmSecret, SwarmService } from "@/env/Types";
import { t } from "@/i18n";
import type { InspectSummaryRow } from "@/web-app/components/InspectSummary";
import { inspectDate, shortId } from "@/web-app/components/inspectSummary.helpers";

import type { SwarmInspectKind } from "./queries";

type SwarmEntity = SwarmService | SwarmNode | SwarmConfig | SwarmSecret;

// Swarm is Docker-only. `kind` is the SINGULAR inspect kind the screen derives (service/node/config/secret);
// `stacks` are handled separately (they render the member ServicesTable, not a REST object).
export function buildSwarmSummary(entity: SwarmEntity, kind: SwarmInspectKind): InspectSummaryRow[] {
  const rows: InspectSummaryRow[] = [];
  if (kind === "service") {
    const s = entity as SwarmService;
    if (s.Spec?.Name) {
      rows.push({ key: "name", label: t("Name"), value: s.Spec.Name, copyText: s.Spec.Name });
    }
    if (s.ID) {
      rows.push({ key: "id", label: t("Id"), value: shortId(s.ID), copyText: s.ID, mono: true });
    }
    const image = s.Spec?.TaskTemplate?.ContainerSpec?.Image;
    if (image) {
      rows.push({ key: "image", label: t("Image"), value: image, copyText: image });
    }
    const mode = s.Spec?.Mode?.Replicated ? "replicated" : s.Spec?.Mode?.Global ? "global" : undefined;
    if (mode) {
      rows.push({ key: "mode", label: t("Mode"), value: mode });
    }
    const replicas = s.Spec?.Mode?.Replicated?.Replicas;
    if (typeof replicas === "number") {
      rows.push({ key: "replicas", label: t("Replicas"), value: `${replicas}` });
    }
  } else if (kind === "node") {
    const n = entity as SwarmNode;
    if (n.Description?.Hostname) {
      rows.push({
        key: "hostname",
        label: t("Hostname"),
        value: n.Description.Hostname,
        copyText: n.Description.Hostname,
      });
    }
    if (n.ID) {
      rows.push({ key: "id", label: t("Id"), value: shortId(n.ID), copyText: n.ID, mono: true });
    }
    if (n.Spec?.Role) {
      rows.push({ key: "role", label: t("Role"), value: n.Spec.Role });
    }
    if (n.Spec?.Availability) {
      rows.push({ key: "availability", label: t("Availability"), value: n.Spec.Availability });
    }
    if (n.Status?.State) {
      rows.push({ key: "state", label: t("State"), value: n.Status.State });
    }
    const engineVersion = n.Description?.Engine?.EngineVersion;
    if (engineVersion) {
      rows.push({ key: "engine", label: t("Engine version"), value: engineVersion });
    }
  } else {
    // config | secret — same identity fields.
    const c = entity as SwarmConfig | SwarmSecret;
    if (c.Spec?.Name) {
      rows.push({ key: "name", label: t("Name"), value: c.Spec.Name, copyText: c.Spec.Name });
    }
    if (c.ID) {
      rows.push({ key: "id", label: t("Id"), value: shortId(c.ID), copyText: c.ID, mono: true });
    }
  }
  const created = (entity as { CreatedAt?: string }).CreatedAt;
  const updated = (entity as { UpdatedAt?: string }).UpdatedAt;
  if (created) {
    rows.push({ key: "created", label: t("Created"), value: inspectDate(created) });
  }
  if (updated) {
    rows.push({ key: "updated", label: t("Updated"), value: inspectDate(updated) });
  }
  return rows;
}
