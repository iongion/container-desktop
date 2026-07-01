import { type AppBreadcrumb, leafCrumbs } from "@/web-app/components/AppBreadcrumbs";
import { pathTo } from "@/web-app/Navigator";

export const getNetworkUrl = (id: string, view: string, connId?: string) => {
  return pathTo(`/screens/network/${encodeURIComponent(id)}/${encodeURIComponent(view)}`, undefined, { connId });
};

/** Canonical network trail: `Networks > name` (single detail view). */
export const getNetworkCrumbs = (name: string, connId?: string): AppBreadcrumb[] =>
  leafCrumbs("networks", name, connId);
