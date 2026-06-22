// The flat Local / Cloud provider menu, shared by the chat popover's ModelNavigator (drill-to-browse) and
// the Settings AIProviderConfig (select-to-configure) — ONE source of truth for ordering
// (compareProviderEntries), brand icons (providerIcon) and the Local/Cloud split, so the two surfaces never
// drift. The behavior differs ONLY by the injected onSelect / renderItemRight (and the optional root
// search filter the chat popover wires up). No popover/persistence assumptions.
import { Menu, MenuDivider, MenuItem } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

import { compareProviderEntries, PROVIDER_CATALOG, type ProviderCatalogEntry } from "@/ai-system/core";
import { providerIcon } from "@/web-app/components/providerIcon";

export interface ProviderSourceListProps {
  /** Provider id to highlight as active — the browsed source (chat) or the one being configured (Settings). */
  activeId?: string;
  /** Row click — the chat popover drills into it (openPanel); Settings selects it to configure. */
  onSelect: (entry: ProviderCatalogEntry) => void;
  /** Optional trailing element per row — the chat popover passes a chevron; Settings omits it. */
  renderItemRight?: (entry: ProviderCatalogEntry) => React.ReactNode;
  /** Optional case-insensitive label filter — the chat popover's root search box; omitted in Settings. */
  filter?: string;
}

export function ProviderSourceList({ activeId, onSelect, renderItemRight, filter }: ProviderSourceListProps) {
  const { t } = useTranslation();
  const q = (filter ?? "").trim().toLowerCase();
  const matches = PROVIDER_CATALOG.filter((e) => !q || e.label.toLowerCase().includes(q));
  const local = matches.filter((e) => !e.cloud).sort(compareProviderEntries);
  const cloud = matches.filter((e) => e.cloud).sort(compareProviderEntries);
  const item = (entry: ProviderCatalogEntry) => (
    <MenuItem
      key={entry.id}
      icon={providerIcon(entry.id)}
      text={entry.label}
      active={entry.id === activeId}
      shouldDismissPopover={false}
      labelElement={renderItemRight?.(entry)}
      onClick={() => onSelect(entry)}
    />
  );
  return (
    <Menu size="small">
      {matches.length === 0 ? <MenuItem disabled text={t("No matching sources.")} /> : null}
      {local.length > 0 ? <MenuDivider title={t("Local")} /> : null}
      {local.map(item)}
      {cloud.length > 0 ? <MenuDivider title={t("Cloud")} /> : null}
      {cloud.map(item)}
    </Menu>
  );
}
