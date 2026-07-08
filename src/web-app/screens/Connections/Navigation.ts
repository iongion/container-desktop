import { IconNames } from "@blueprintjs/icons";
import { type AppBreadcrumb, crumb } from "@/web-app/components/AppBreadcrumbs";
import { pathTo } from "@/web-app/Navigator";

export const getConnectionsUrl = (view: string) => {
  return pathTo(`/screens/connections/${encodeURIComponent(view)}`);
};

export const getConnectionUrl = (id: string, view: string) => {
  return pathTo(`/screens/connections/${encodeURIComponent(id)}/${encodeURIComponent(view)}`);
};

const CONNECTION_VIEW_LABELS: Record<string, string> = {
  "connection-info": "Connection info",
  health: "Engine health",
  "system-info": "System info",
};

export const getConnectionCrumbs = (name: string, view: string, id: string): AppBreadcrumb[] => [
  crumb({ textKey: "Connections", icon: IconNames.DATA_CONNECTION, href: getConnectionsUrl("manage") }),
  crumb({
    text: name,
    href: view === "connection-info" ? undefined : getConnectionUrl(id, "connection-info"),
  }),
  crumb({ textKey: CONNECTION_VIEW_LABELS[view] ?? view, current: true }),
];
