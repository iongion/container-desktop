import type { Container, ContainerState } from "@/env/Types";
import { t } from "@/i18n";
import type { InspectSummaryRow } from "@/web-app/components/InspectSummary";
import { inspectDate, shortId } from "@/web-app/components/inspectSummary.helpers";
import { sortAlphaNum } from "@/web-app/domain/utils";
import { statusTone } from "./health";

// A single published-port mapping. Tolerant of both engine shapes: Docker inspect's
// NetworkSettings.Ports and the HostConfig.PortBindings map (the field the ports table already used).
interface ContainerPortPair {
  containerPort: string;
  hostBinding: string;
}

function containerPortPairs(container: Container): ContainerPortPair[] {
  const pairs: ContainerPortPair[] = [];
  const nsPorts = container.NetworkSettings?.Ports;
  if (nsPorts) {
    for (const [key, binds] of Object.entries(nsPorts)) {
      for (const b of binds || []) {
        pairs.push({ containerPort: key, hostBinding: `${b.HostIp || "0.0.0.0"}:${b.HostPort}` });
      }
    }
  }
  if (!pairs.length) {
    const bindings = container.HostConfig?.PortBindings || {};
    for (const [key, binds] of Object.entries(bindings)) {
      for (const b of (binds || []) as any[]) {
        const ip = b.HostIp || b.hostIp || "0.0.0.0";
        const port = b.HostPort || b.hostPort || "";
        pairs.push({ containerPort: key, hostBinding: `${ip}:${port}` });
      }
    }
  }
  return pairs;
}

// Container identity/state summary. Prefers the normalizer's Computed.* fields (the only ones guaranteed
// uniform across engines) and reads the image ref as a human name — ImageName (Podman) or Config.Image
// (Docker inspect), falling back to the raw Image (a sha on Docker inspect) only as a last resort.
export function buildContainerSummary(container: Container): InspectSummaryRow[] {
  const rows: InspectSummaryRow[] = [];
  // Name is intentionally omitted here — it already shows in the breadcrumbs / screen header.
  const image = container.ImageName || (container.Config as any)?.Image || container.Image;
  if (image) {
    rows.push({ key: "image", label: t("Image"), value: image, copyText: image, render: "tag" });
  }
  // Raw state token (not pre-translated): the StatePill colors by data-state and translates the label itself,
  // so the color stays correct in every locale. In English this is byte-identical to the old t(state).
  const state =
    container.Computed?.DecodedState ??
    (typeof container.State === "string" ? container.State : (container.State as ContainerState)?.Status);
  if (state) {
    rows.push({ key: "state", label: t("State"), value: state, render: "state" });
  }
  if (container.Computed?.Health) {
    rows.push({
      key: "health",
      label: t("Health"),
      value: t(container.Computed.Health),
      render: "health",
      tone: statusTone(container),
    });
  }
  const cmd = container.Config?.Cmd?.length ? container.Config.Cmd : container.Command;
  if (cmd?.length) {
    rows.push({ key: "command", label: t("Command"), value: cmd.join(" "), mono: true, render: "code" });
  }
  // Ports are intentionally omitted here — they render in their own Property/Value table (buildContainerPortRows).
  if (container.Created) {
    rows.push({ key: "created", label: t("Created"), value: inspectDate(container.Created), render: "date" });
  }
  if (container.Id) {
    rows.push({
      key: "id",
      label: t("Id"),
      value: shortId(container.Id),
      copyText: container.Id,
      mono: true,
      render: "code",
    });
  }
  return rows;
}

// Per-variable rows for the Environment Property/Value table, sorted by name and split on the FIRST "="
// so values that themselves contain "=" (URLs, base64, key=value payloads) survive intact.
export function buildContainerEnvRows(container: Container): InspectSummaryRow[] {
  const env = container.Config?.Env || [];
  return [...env].sort(sortAlphaNum).map((entry, index) => {
    const eq = entry.indexOf("=");
    const name = eq >= 0 ? entry.slice(0, eq) : entry;
    const value = eq >= 0 ? entry.slice(eq + 1) : "";
    return { key: `env_${index}_${name}`, label: name, value, copyText: value, mono: true };
  });
}

// Per-mapping rows for the Ports Property/Value table: container port (e.g. "9000/tcp") → host binding
// (e.g. "0.0.0.0:9000"), tolerant of both the NetworkSettings.Ports and HostConfig.PortBindings shapes.
export function buildContainerPortRows(container: Container): InspectSummaryRow[] {
  return containerPortPairs(container).map((p, index) => ({
    key: `port_${index}_${p.containerPort}`,
    label: p.containerPort,
    value: p.hostBinding,
    copyText: p.hostBinding,
    mono: true,
  }));
}

// Per-mount rows for the Mounts table: Container path (Destination) in the label column, Host path (Source)
// in the value column. Rendered by the sortable PropertyValueTable relabeled "Container" / "Host", so it
// sorts ascending by Container path by default and switches to Host path on demand. Copies the host source.
export function buildContainerMountRows(container: Container): InspectSummaryRow[] {
  return (container.Mounts || []).map((mount, index) => ({
    key: `mount_${index}_${mount.Destination}`,
    label: mount.Destination,
    value: mount.Source,
    copyText: mount.Source,
    mono: true,
  }));
}
