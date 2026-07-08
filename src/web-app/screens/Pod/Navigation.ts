import i18n from "@/i18n";
import { type AppBreadcrumb, tabbedCrumbs } from "@/web-app/components/AppBreadcrumbs";
import { pathTo } from "@/web-app/Navigator";

export const getPodUrl = (id: string, view: string, connId?: string) => {
  return pathTo(`/screens/pod/${encodeURIComponent(id)}/${encodeURIComponent(view)}`, undefined, { connId });
};

// Sub-tab label per view segment (keys match the ActionsMenu wording).
const POD_VIEW_LABELS: Record<string, string> = {
  logs: i18n.t("Logs"),
  processes: i18n.t("Processes"),
  kube: i18n.t("Kube"),
};

/** Canonical pod trail: `Pods > name` on inspect; `Pods > name > Tab` on a sub-tab. */
export const getPodCrumbs = (name: string, id: string, currentScreen: string, connId?: string): AppBreadcrumb[] => {
  const view = currentScreen.split(".")[1] ?? "inspect";
  return tabbedCrumbs("pods", name, getPodUrl(id, "inspect", connId), connId, POD_VIEW_LABELS[view]);
};
