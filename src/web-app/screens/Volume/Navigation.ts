import { type AppBreadcrumb, leafCrumbs } from "@/web-app/components/AppBreadcrumbs";
import { pathTo } from "@/web-app/Navigator";

export const getVolumeUrl = (id: string, view: string, connId?: string) => {
  return pathTo(`/screens/volumes/${encodeURIComponent(id)}/${encodeURIComponent(view)}`, undefined, { connId });
};

// The two Volumes sections (for the navbar tab navigator): the list (sidebar target `/screens/volumes`) and the
// Mounts inspector sub-screen (`/screens/volumes/mounts`).
export const getVolumesUrl = (view: "manage" | "mounts") => {
  return pathTo(view === "mounts" ? "/screens/volumes/mounts" : "/screens/volumes");
};

/** Canonical volume trail: `Volumes > name` (single detail view). */
export const getVolumeCrumbs = (name: string, connId?: string): AppBreadcrumb[] => leafCrumbs("volumes", name, connId);
