import { type AppBreadcrumb, tabbedCrumbs } from "@/web-app/components/AppBreadcrumbs";
import { pathTo } from "@/web-app/Navigator";

export const getImageUrl = (id: string, view: string, connId?: string) => {
  return pathTo(`/screens/image/${encodeURIComponent(id)}/${encodeURIComponent(view)}`, undefined, { connId });
};

// Sub-tab label per view segment (keys match the ActionsMenu wording).
const IMAGE_VIEW_LABELS: Record<string, string> = {
  layers: "Layers",
  security: "Security",
};

/** Canonical image trail: `Images > name` on inspect; `Images > name > Tab` on a sub-tab. */
export const getImageCrumbs = (name: string, id: string, currentScreen: string, connId?: string): AppBreadcrumb[] => {
  const view = currentScreen.split(".")[1] ?? "inspect";
  return tabbedCrumbs("images", name, getImageUrl(id, "inspect", connId), connId, IMAGE_VIEW_LABELS[view]);
};
