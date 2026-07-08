import { Boundary, type BreadcrumbProps, Breadcrumbs } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

import type { AppBreadcrumb } from "./crumbs";
import "./AppBreadcrumbs.css";

interface AppBreadcrumbsProps {
  items: AppBreadcrumb[];
}

/**
 * Renders a canonical breadcrumb trail using Blueprint's own Breadcrumbs component. i18n is resolved here
 * (translatable `textKey` vs literal `text`) so the trail builders stay pure. `collapseFrom=START` +
 * `minVisibleItems=1` means a long trail collapses leading crumbs into a `…` overflow menu and always
 * keeps the current leaf visible — it never truncates text mid-word.
 */
export const AppBreadcrumbs: React.FC<AppBreadcrumbsProps> = ({ items }) => {
  const { t } = useTranslation();
  const bpItems: BreadcrumbProps[] = items
    .map((item, index) => ({
      text: item.textKey ? t(item.textKey) : (item.text ?? ""),
      icon: index === 0 ? item.icon : undefined,
      href: item.current ? undefined : item.href,
      current: item.current,
    }))
    // Drop crumbs with no visible text (e.g. a resource whose name has not resolved yet) so we never
    // render a dangling separator with an empty item after it.
    .filter((item) => item.text !== "");
  return <Breadcrumbs className="AppBreadcrumbs" collapseFrom={Boundary.START} minVisibleItems={1} items={bpItems} />;
};
