import { IconNames } from "@blueprintjs/icons";
import { type Container, ContainerEngine } from "@/env/Types";
import i18n from "@/i18n";
import { type AppBreadcrumb, tabbedCrumbs } from "@/web-app/components/AppBreadcrumbs";
import type { ResourceSectionRailItem } from "@/web-app/components/ResourceSectionRail";
import { pathTo } from "@/web-app/Navigator";
import { buildContainerEnvRows, buildContainerMountRows, buildContainerPortRows } from "./inspectSummary";

export const getContainerUrl = (id: string, view: string, connId?: string) => {
  return pathTo(`/screens/container/${encodeURIComponent(id)}/${encodeURIComponent(view)}`, undefined, { connId });
};

// The Container detail section rail — one flat rail shared by every container detail screen. The Inspect
// facets (Inspect = the Summary panel, Env vars, Ports, Mounts, Raw configuration) navigate to the inspect
// route with a `?section=` selector; Logs/Processes/Kube are their own routes. Env/Ports/Mounts appear only
// when the container has them, each with a count pill. Ids match the active screen/section for highlighting.
export const containerSectionRailItems = (
  container: Container,
  connId?: string,
  engine?: ContainerEngine,
): ResourceSectionRailItem[] => {
  const id = container.Id;
  const inspectSection = (section?: string) =>
    pathTo(`/screens/container/${encodeURIComponent(id)}/inspect`, undefined, { connId, section });
  const items: ResourceSectionRailItem[] = [
    { id: "container.inspect", label: i18n.t("Inspect"), icon: IconNames.EYE_OPEN, href: inspectSection() },
  ];
  const envCount = buildContainerEnvRows(container).length;
  const portCount = buildContainerPortRows(container).length;
  const mountCount = buildContainerMountRows(container).length;
  if (envCount > 0) {
    items.push({
      id: "container.inspect.env",
      label: i18n.t("Env vars"),
      icon: IconNames.VARIABLE,
      count: envCount,
      href: inspectSection("env"),
    });
  }
  if (portCount > 0) {
    items.push({
      id: "container.inspect.ports",
      label: i18n.t("Ports"),
      icon: IconNames.GLOBE_NETWORK,
      count: portCount,
      href: inspectSection("ports"),
    });
  }
  if (mountCount > 0) {
    items.push({
      id: "container.inspect.mounts",
      label: i18n.t("Mounts"),
      icon: IconNames.FOLDER_CLOSE,
      count: mountCount,
      href: inspectSection("mounts"),
    });
  }
  items.push(
    {
      id: "container.logs",
      label: i18n.t("Logs"),
      icon: IconNames.ALIGN_JUSTIFY,
      href: getContainerUrl(id, "logs", connId),
    },
    {
      id: "container.processes",
      label: i18n.t("Processes"),
      icon: IconNames.PANEL_TABLE,
      href: getContainerUrl(id, "processes", connId),
    },
    {
      id: "container.kube",
      label: i18n.t("Kube"),
      icon: IconNames.TEXT_HIGHLIGHT,
      href: getContainerUrl(id, "kube", connId),
      // Only Podman can `generate kube`; disable it on Docker/Apple hosts (as the original header did).
      disabled: engine !== ContainerEngine.PODMAN,
      title: engine === ContainerEngine.PODMAN ? undefined : i18n.t("Not available for current host"),
    },
    {
      id: "container.inspect.raw",
      label: i18n.t("Raw configuration"),
      icon: IconNames.CODE,
      href: inspectSection("raw"),
    },
  );
  return items;
};

// Sub-tab label per view segment (keys match the ActionsMenu wording). The default/inspect view has no
// entry — there the resource name itself is the current leaf.
const CONTAINER_VIEW_LABELS: Record<string, string> = {
  logs: i18n.t("Logs"),
  stats: i18n.t("Stats"),
  processes: i18n.t("Processes"),
  kube: i18n.t("Kube"),
  terminal: i18n.t("Terminal"),
};

// Canonical container trail: `Containers > name` on the inspect view; `Containers > name > Tab` on a
// sub-tab (name links back to inspect). `currentScreen` is the active sub-screen id, e.g. "container.logs".
export const getContainerCrumbs = (
  name: string,
  id: string,
  currentScreen: string,
  connId?: string,
): AppBreadcrumb[] => {
  const view = currentScreen.split(".")[1] ?? "inspect";
  return tabbedCrumbs("containers", name, getContainerUrl(id, "inspect", connId), connId, CONTAINER_VIEW_LABELS[view]);
};

export const getContainerServiceUrl = (container: Container) => {
  const port = (container.Ports || [])[0];
  let serviceUrl = "";
  if (port) {
    if (port.PublicPort) {
      serviceUrl = `http://localhost:${port.PublicPort}`;
    } else {
      const hostIp = port.hostIP || port.host_ip || "localhost";
      const hostPort = port.hostPort || port.host_port || 80;
      serviceUrl = `http://${hostIp === "0.0.0.0" ? "localhost" : hostIp}:${hostPort}`;
    }
  } else {
    const portFromNetworkSettings = container.NetworkSettings?.Ports || {};
    const servicePorts = Object.values(portFromNetworkSettings);
    const [firstPort] = servicePorts;
    if (firstPort?.[0]) {
      const hostIp = firstPort[0].HostIp || "localhost";
      serviceUrl = `http://${hostIp === "0.0.0.0" ? "localhost" : hostIp}:${firstPort[0].HostPort}`;
    }
  }
  return serviceUrl;
};
