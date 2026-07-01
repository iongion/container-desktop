import { type AppBreadcrumb, leafCrumbs } from "@/web-app/components/AppBreadcrumbs";
import { pathTo } from "@/web-app/Navigator";

export const getSecretUrl = (id: string, view: string, connId?: string) => {
  return pathTo(`/screens/secrets/${encodeURIComponent(id)}/${encodeURIComponent(view)}`, undefined, { connId });
};

/** Canonical secret trail: `Secrets > name` (single detail view). */
export const getSecretCrumbs = (name: string, connId?: string): AppBreadcrumb[] => leafCrumbs("secrets", name, connId);
