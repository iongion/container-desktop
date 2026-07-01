import { type AppBreadcrumb, leafCrumbs } from "@/web-app/components/AppBreadcrumbs";
import { pathTo } from "@/web-app/Navigator";

export const getVolumeUrl = (id: string, view: string, connId?: string) => {
  return pathTo(`/screens/volumes/${encodeURIComponent(id)}/${encodeURIComponent(view)}`, undefined, { connId });
};

/** Canonical volume trail: `Volumes > name` (single detail view). */
export const getVolumeCrumbs = (name: string, connId?: string): AppBreadcrumb[] => leafCrumbs("volumes", name, connId);
