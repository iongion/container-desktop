import type { Container, ContainerState } from "@/env/Types";
import { t } from "@/i18n";
import type { InspectSummaryRow } from "@/web-app/components/InspectSummary";
import { inspectDate, shortId } from "@/web-app/components/inspectSummary.helpers";

// Compact published-ports string, tolerant of both engine shapes: Docker inspect's
// NetworkSettings.Ports and the HostConfig.PortBindings map (the field the grouped table already uses).
function containerPorts(container: Container): string {
  const out: string[] = [];
  const nsPorts = container.NetworkSettings?.Ports;
  if (nsPorts) {
    for (const [key, binds] of Object.entries(nsPorts)) {
      for (const b of binds || []) {
        out.push(`${b.HostIp || "0.0.0.0"}:${b.HostPort}→${key}`);
      }
    }
  }
  if (!out.length) {
    const bindings = container.HostConfig?.PortBindings || {};
    for (const [key, binds] of Object.entries(bindings)) {
      for (const b of (binds || []) as any[]) {
        const ip = b.HostIp || b.hostIp || "0.0.0.0";
        const port = b.HostPort || b.hostPort || "";
        out.push(`${ip}:${port}→${key}`);
      }
    }
  }
  return out.join(", ");
}

// Container identity/state summary. Prefers the normalizer's Computed.* fields (the only ones guaranteed
// uniform across engines) and reads the image ref as a human name — ImageName (Podman) or Config.Image
// (Docker inspect), falling back to the raw Image (a sha on Docker inspect) only as a last resort.
export function buildContainerSummary(container: Container): InspectSummaryRow[] {
  const rows: InspectSummaryRow[] = [];
  // Computed.Name is already de-slashed by the normalizer; strip the leading "/" on the raw fallbacks.
  const name = container.Computed?.Name || (container.Name || container.Names?.[0] || "").replace(/^\//, "");
  if (name) {
    rows.push({ key: "name", label: t("Name"), value: name, copyText: name });
  }
  const image = container.ImageName || (container.Config as any)?.Image || container.Image;
  if (image) {
    rows.push({ key: "image", label: t("Image"), value: image, copyText: image });
  }
  const state =
    container.Computed?.DecodedState ??
    (typeof container.State === "string" ? container.State : (container.State as ContainerState)?.Status);
  if (state) {
    rows.push({ key: "state", label: t("State"), value: state });
  }
  if (container.Computed?.Health) {
    rows.push({ key: "health", label: t("Health"), value: container.Computed.Health });
  }
  const cmd = container.Config?.Cmd?.length ? container.Config.Cmd : container.Command;
  if (cmd?.length) {
    rows.push({ key: "command", label: t("Command"), value: cmd.join(" "), mono: true });
  }
  const ports = containerPorts(container);
  if (ports) {
    rows.push({ key: "ports", label: t("Ports"), value: ports, mono: true });
  }
  if (container.Created) {
    rows.push({ key: "created", label: t("Created"), value: inspectDate(container.Created) });
  }
  if (container.Id) {
    rows.push({ key: "id", label: t("Id"), value: shortId(container.Id), copyText: container.Id, mono: true });
  }
  return rows;
}
