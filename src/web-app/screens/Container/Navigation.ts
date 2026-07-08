import type { Container } from "@/env/Types";
import i18n from "@/i18n";
import { type AppBreadcrumb, tabbedCrumbs } from "@/web-app/components/AppBreadcrumbs";
import { pathTo } from "@/web-app/Navigator";

export const getContainerUrl = (id: string, view: string, connId?: string) => {
  return pathTo(`/screens/container/${encodeURIComponent(id)}/${encodeURIComponent(view)}`, undefined, { connId });
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

/**
 * Canonical container trail: `Containers > name` on the inspect view; `Containers > name > Tab` on a
 * sub-tab (name links back to inspect). `currentScreen` is the active sub-screen id, e.g. "container.logs".
 */
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
