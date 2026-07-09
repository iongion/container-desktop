import type { BreadcrumbProps } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiNetwork } from "@mdi/js";
import * as ReactIcon from "@mdi/react";
import { createElement } from "react";

import { pathTo } from "@/web-app/Navigator";

/**
 * One crumb in a breadcrumb trail. `textKey` is a translatable label (a section/tab name), resolved with
 * `t()` inside AppBreadcrumbs; `text` is a literal value (a resource name) that must NEVER be translated.
 * Keeping that distinction here lets every trail builder stay pure (no i18n dependency) and trivially
 * unit-testable, while i18n stays centralized in the render component.
 */
export interface AppBreadcrumb {
  textKey?: string;
  text?: string;
  icon?: BreadcrumbProps["icon"];
  href?: string;
  current?: boolean;
  // Render-time marker for the owning-connection crumb: AppBreadcrumbs resolves this id to the connection's
  // display name (the pure builders never read the store). An absent/unknown id renders empty and is dropped.
  connectionId?: string;
}

/** Identity/normalizer so builders read declaratively, e.g. `crumb({ text: name, current: true })`. */
export function crumb(partial: AppBreadcrumb): AppBreadcrumb {
  return partial;
}

export type RootCrumbId = "containers" | "images" | "pods" | "machines" | "networks" | "volumes" | "secrets" | "swarm";

// The canonical section roots. Labels double as i18n keys. Hardcoded (stable) rather than read from the
// Screens registry, which would create an import cycle through App.tsx.
const ROOT_CRUMBS: Record<RootCrumbId, { labelKey: string; path: string; icon: BreadcrumbProps["icon"] }> = {
  containers: { labelKey: "Containers", path: "/screens/containers", icon: IconNames.CUBE },
  images: { labelKey: "Images", path: "/screens/images", icon: IconNames.BOX },
  pods: { labelKey: "Pods", path: "/screens/pods", icon: IconNames.CUBE_ADD },
  machines: { labelKey: "Machines", path: "/screens/machines", icon: IconNames.HEAT_GRID },
  networks: {
    labelKey: "Networks",
    path: "/screens/networks",
    icon: createElement(ReactIcon.Icon, { className: "ReactIcon", path: mdiNetwork, size: 0.75 }),
  },
  volumes: { labelKey: "Volumes", path: "/screens/volumes", icon: IconNames.DATABASE },
  secrets: { labelKey: "Secrets", path: "/screens/secrets", icon: IconNames.KEY },
  swarm: { labelKey: "Swarm", path: "/screens/swarm", icon: IconNames.LAYERS },
};

/** The leading crumb for a section — links to its list screen, preserving the owning connection. */
export function rootCrumb(rootId: RootCrumbId, connId?: string): AppBreadcrumb {
  const spec = ROOT_CRUMBS[rootId];
  return { textKey: spec.labelKey, icon: spec.icon, href: pathTo(spec.path, undefined, { connId }) };
}

/**
 * The leading crumb naming the resource's owning connection, linking to its Connection info page — so every
 * resource trail reads `Connection > Section > name`. A render-time marker (see AppBreadcrumb.connectionId):
 * the display name resolves in AppBreadcrumbs, and an absent/unknown id renders empty and is dropped (not
 * every view has an owning connection). The Connections screens' own trails never use it — a connection
 * doesn't lead with itself.
 */
export function connectionCrumb(connId?: string): AppBreadcrumb {
  return {
    connectionId: connId,
    // No icon: the trail's single leading icon is the entity/section icon (see AppBreadcrumbs), not this crumb.
    // Mirrors ConnectionInfo Route.Path. Kept inline (not getConnectionUrl) so this shared component never
    // imports the Connections screen back — that would be an import cycle through the AppBreadcrumbs barrel.
    href: connId ? pathTo(`/screens/connections/${encodeURIComponent(connId)}/connection-info`) : undefined,
  };
}

/**
 * Canonical trail for an entity with a single detail view: `Connection > Root > name`, the name being the
 * current leaf. Used by Volume/Network/Secret/Machine.
 */
export function leafCrumbs(rootId: RootCrumbId, name: string, connId?: string): AppBreadcrumb[] {
  return [connectionCrumb(connId), rootCrumb(rootId, connId), crumb({ text: name, current: true })];
}

/**
 * Canonical trail for an entity with sub-tabs. On the default/inspect view (no `tabLabel`) the resource
 * name is the current leaf: `Connection > Root > name`. On a sub-tab the name links back to inspect and the
 * tab becomes the current leaf: `Connection > Root > name > Tab`. `inspectHref` is that resource's
 * default-view URL (connId-scoped).
 */
export function tabbedCrumbs(
  rootId: RootCrumbId,
  name: string,
  inspectHref: string,
  connId: string | undefined,
  tabLabel?: string,
): AppBreadcrumb[] {
  const trail: AppBreadcrumb[] = [connectionCrumb(connId), rootCrumb(rootId, connId)];
  if (tabLabel) {
    trail.push(crumb({ text: name, href: inspectHref }));
    trail.push(crumb({ textKey: tabLabel, current: true }));
  } else {
    trail.push(crumb({ text: name, current: true }));
  }
  return trail;
}
