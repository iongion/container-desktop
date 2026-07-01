import { type AppBreadcrumb, leafCrumbs } from "@/web-app/components/AppBreadcrumbs";
import { pathTo } from "@/web-app/Navigator";

export const getMachineUrl = (id: string, view: string, connId?: string) => {
  return pathTo(`/screens/machines/${encodeURIComponent(id)}/${encodeURIComponent(view)}`, undefined, { connId });
};

/** Canonical machine trail: `Machines > name` (single detail view). */
export const getMachineCrumbs = (name: string, connId?: string): AppBreadcrumb[] =>
  leafCrumbs("machines", name, connId);
