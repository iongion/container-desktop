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
