import { type AppBreadcrumb, leafCrumbs } from "@/web-app/components/AppBreadcrumbs";
import { pathTo } from "@/web-app/Navigator";

export const getNetworkUrl = (id: string, view: string, connId?: string) => {
  return pathTo(`/screens/network/${encodeURIComponent(id)}/${encodeURIComponent(view)}`, undefined, { connId });
};

// The two Networks sections (for the navbar tab navigator): the list (sidebar target `/screens/networks`) and
// the Reachability debugger sub-screen (`/screens/networks/reachability`). Mirrors Volumes' getVolumesUrl.
export const getNetworksUrl = (view: "manage" | "reachability") => {
  return pathTo(view === "reachability" ? "/screens/networks/reachability" : "/screens/networks");
};

// Canonical network trail: `Networks > name` (single detail view).
export const getNetworkCrumbs = (name: string, connId?: string): AppBreadcrumb[] =>
  leafCrumbs("networks", name, connId);
