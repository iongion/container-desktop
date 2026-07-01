import { pathTo } from "@/web-app/Navigator";

/**
 * One crumb in a breadcrumb trail. `textKey` is a translatable label (a section/tab name), resolved with
 * `t()` inside AppBreadcrumbs; `text` is a literal value (a resource name) that must NEVER be translated.
 * Keeping that distinction here lets every trail builder stay pure (no i18n dependency) and trivially
 * unit-testable, while i18n stays centralized in the render component. Breadcrumbs are text-only (no icons).
 */
export interface AppBreadcrumb {
  textKey?: string;
  text?: string;
  href?: string;
  current?: boolean;
}

/** Identity/normalizer so builders read declaratively, e.g. `crumb({ text: name, current: true })`. */
export function crumb(partial: AppBreadcrumb): AppBreadcrumb {
  return partial;
}

export type RootCrumbId = "containers" | "images" | "pods" | "machines" | "networks" | "volumes" | "secrets" | "swarm";

// The canonical section roots. Labels double as i18n keys. Hardcoded (stable) rather than read from the
// Screens registry, which would create an import cycle through App.tsx.
const ROOT_CRUMBS: Record<RootCrumbId, { labelKey: string; path: string }> = {
  containers: { labelKey: "Containers", path: "/screens/containers" },
  images: { labelKey: "Images", path: "/screens/images" },
  pods: { labelKey: "Pods", path: "/screens/pods" },
  machines: { labelKey: "Machines", path: "/screens/machines" },
  networks: { labelKey: "Networks", path: "/screens/networks" },
  volumes: { labelKey: "Volumes", path: "/screens/volumes" },
  secrets: { labelKey: "Secrets", path: "/screens/secrets" },
  swarm: { labelKey: "Swarm", path: "/screens/swarm" },
};

/** The leading crumb for a section — links to its list screen, preserving the owning connection. */
export function rootCrumb(rootId: RootCrumbId, connId?: string): AppBreadcrumb {
  const spec = ROOT_CRUMBS[rootId];
  return { textKey: spec.labelKey, href: pathTo(spec.path, undefined, { connId }) };
}

/**
 * Canonical two-level trail for an entity with a single detail view: `Root > name`, the name being the
 * current leaf. Used by Volume/Network/Secret/Machine.
 */
export function leafCrumbs(rootId: RootCrumbId, name: string, connId?: string): AppBreadcrumb[] {
  return [rootCrumb(rootId, connId), crumb({ text: name, current: true })];
}

/**
 * Canonical trail for an entity with sub-tabs. On the default/inspect view (no `tabLabel`) the resource
 * name is the current leaf: `Root > name`. On a sub-tab the name links back to inspect and the tab becomes
 * the current leaf: `Root > name > Tab`. `inspectHref` is that resource's default-view URL (connId-scoped).
 */
export function tabbedCrumbs(
  rootId: RootCrumbId,
  name: string,
  inspectHref: string,
  connId: string | undefined,
  tabLabel?: string,
): AppBreadcrumb[] {
  const trail: AppBreadcrumb[] = [rootCrumb(rootId, connId)];
  if (tabLabel) {
    trail.push(crumb({ text: name, href: inspectHref }));
    trail.push(crumb({ textKey: tabLabel, current: true }));
  } else {
    trail.push(crumb({ text: name, current: true }));
  }
  return trail;
}
