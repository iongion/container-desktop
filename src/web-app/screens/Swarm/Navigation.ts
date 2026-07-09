import i18n from "@/i18n";
import { type AppBreadcrumb, connectionCrumb, crumb, rootCrumb } from "@/web-app/components/AppBreadcrumbs";
import { pathTo } from "@/web-app/Navigator";

export type SwarmTab = "services" | "nodes" | "stacks" | "secrets" | "configs";

// The Swarm manage route is param-free (`/screens/swarm`) so the sidebar's pathTo(Route.Path) never
// throws on an unfilled param; the active tab + connection ride as search params.
export const getSwarmTabUrl = (tab: SwarmTab, connId?: string) => pathTo("/screens/swarm", undefined, { tab, connId });

// One generic inspect/detail route for every swarm entity kind. `kind` is the plural path segment; for
// services/nodes/configs/secrets the screen shows the JSON, for stacks it lists the member services.
export type SwarmInspectSegment = SwarmTab;

export const getSwarmInspectUrl = (kind: SwarmInspectSegment, id: string, connId?: string) =>
  pathTo(`/screens/swarm/${kind}/${encodeURIComponent(id)}/inspect`, undefined, { connId });

// Section label per swarm entity kind (keys match the tab strip wording).
const SWARM_KIND_LABELS: Record<SwarmInspectSegment, string> = {
  services: i18n.t("Services"),
  nodes: i18n.t("Nodes"),
  stacks: i18n.t("Stacks"),
  secrets: i18n.t("Secrets"),
  configs: i18n.t("Configs"),
};

// Canonical swarm trail: `Connection > Swarm > Kind > leaf` (e.g. `System Docker > Swarm > Services >
// shop_web`). The kind crumb links back to that kind's tab; `leaf` is the resolved entity name/id.
export const getSwarmCrumbs = (kind: SwarmInspectSegment, leaf: string, connId?: string): AppBreadcrumb[] => [
  connectionCrumb(connId),
  rootCrumb("swarm", connId),
  crumb({ textKey: SWARM_KIND_LABELS[kind], href: getSwarmTabUrl(kind, connId) }),
  crumb({ text: leaf, current: true }),
];
