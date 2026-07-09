import { Boundary, type BreadcrumbProps, Breadcrumbs, Icon } from "@blueprintjs/core";
import { isValidElement, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useAppStore } from "@/web-app/stores/appStore";
import type { AppBreadcrumb } from "./crumbs";
import "./AppBreadcrumbs.css";

interface AppBreadcrumbsProps {
  items: AppBreadcrumb[];
}

/**
 * Renders a canonical breadcrumb trail using Blueprint's own Breadcrumbs component. i18n is resolved here
 * (translatable `textKey` vs literal `text`) so the trail builders stay pure. The owning-connection crumb
 * arrives as a bare `connectionId` (again, to keep the builders pure and store-free) and is resolved to its
 * display name here — once, rather than in every screen. The entity/section icon renders once, standalone in
 * front of the trail (not as a crumb); the crumbs themselves are icon-free text links. `collapseFrom=START` +
 * `minVisibleItems=1` means a long trail collapses leading crumbs into a `…` overflow menu and always keeps
 * the current leaf visible.
 */
export const AppBreadcrumbs: React.FC<AppBreadcrumbsProps> = ({ items }) => {
  const { t } = useTranslation();
  const connections = useAppStore((state) => state.connections);
  const connectionsById = useMemo(() => new Map(connections.map((c) => [c.id, c])), [connections]);
  // The lone leading icon is the entity/section icon (it rides on the section root crumb, ROOT_CRUMBS).
  const leadIcon = items.find((item) => item.icon)?.icon;
  const bpItems: BreadcrumbProps[] = items
    .map((item) => {
      if (item.connectionId) {
        // Unknown id (or connections not loaded yet) → empty text, dropped below; a connection is never the
        // current leaf, so it always stays a link.
        const connection = connectionsById.get(item.connectionId);
        return { text: connection?.name ?? "", href: connection ? item.href : undefined };
      }
      return {
        text: item.textKey ? t(item.textKey) : (item.text ?? ""),
        href: item.current ? undefined : item.href,
        current: item.current,
      };
    })
    // Drop crumbs with no visible text (e.g. a resource whose name has not resolved yet) so we never
    // render a dangling separator with an empty item after it.
    .filter((item) => item.text !== "");
  return (
    <div className="AppBreadcrumbs">
      {leadIcon ? (
        <span className="AppBreadcrumbsLeadIcon">{isValidElement(leadIcon) ? leadIcon : <Icon icon={leadIcon} />}</span>
      ) : null}
      <Breadcrumbs collapseFrom={Boundary.START} minVisibleItems={1} items={bpItems} />
    </div>
  );
};
