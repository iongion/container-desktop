// The flat Local / Cloud provider menu, shared by the chat popover's ModelNavigator (drill-to-browse) and
// the Settings AIProviderConfig (select-to-configure) — ONE source of truth for ordering
// (compareProviderEntries), brand icons (providerIcon) and the Local/Cloud split, so the two surfaces never
// drift. The behavior differs ONLY by the injected onSelect / renderItemRight (and the optional root
// search filter the chat popover wires up). No popover/persistence assumptions.
import { Menu, MenuDivider, MenuItem } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

import {
  compareProviderEntries,
  getProviderEntry,
  PROVIDER_CATALOG,
  type ProviderCatalogEntry,
} from "@/ai-system/core/providers";
import { DEFAULT_AI_SETTINGS } from "@/ai-system/core/settings";
import { piCatalogEntry, providerSources, sourceCatalogEntry } from "@/ai-system/ui/core/providerSources";
import { providerIcon } from "@/web-app/components/providerIcon";
import { useAppStore } from "@/web-app/stores/appStore";

export interface ProviderSourceListProps {
  // Provider id to highlight as active — the browsed source (chat) or the one being configured (Settings).
  activeId?: string;
  // Row click — the chat popover drills into it (openPanel); Settings selects it to configure.
  onSelect: (entry: ProviderCatalogEntry) => void;
  // Optional trailing element per row — the chat popover passes a chevron; Settings omits it.
  renderItemRight?: (entry: ProviderCatalogEntry) => React.ReactNode;
  // Optional case-insensitive label filter — the chat popover's root search box; omitted in Settings.
  filter?: string;
  // Offer the providers pi ships that the app has no entry for. The chat popover browses them; Settings lists only
  // what it can already configure.
  includePiCatalogue?: boolean;
}

export function ProviderSourceList({
  activeId,
  onSelect,
  renderItemRight,
  filter,
  includePiCatalogue = false,
}: ProviderSourceListProps) {
  const { t } = useTranslation();
  const ai = useAppStore((state) => state.userSettings.ai) ?? DEFAULT_AI_SETTINGS;
  const q = (filter ?? "").trim().toLowerCase();
  const matches = PROVIDER_CATALOG.filter((entry) => !q || t(entry.labelKey).toLowerCase().includes(q));
  const local = matches.filter((e) => !e.cloud).sort(compareProviderEntries);
  const cloud = matches.filter((e) => e.cloud).sort(compareProviderEntries);
  // Only the chat picker offers pi's breadth: a row there is browsed, and adopting one writes the settings entry.
  // The Settings configurator lists what it can already configure, which is the app's own catalogue.
  const groups = providerSources(ai, filter ?? "");
  const more = includePiCatalogue ? groups.more : [];
  // A provider ADOPTED from pi's catalogue has a settings entry and no catalogue row. It belongs with the cloud
  // sources on BOTH surfaces: a session can start on it, and Settings has to list it or its key could never be set.
  const adopted = groups.configured.filter((source) => !getProviderEntry(source.id));
  const item = (entry: ProviderCatalogEntry) => (
    <MenuItem
      key={entry.id}
      icon={providerIcon(entry.id)}
      text={t(entry.labelKey)}
      active={entry.id === activeId}
      shouldDismissPopover={false}
      labelElement={renderItemRight?.(entry)}
      onClick={() => onSelect(entry)}
    />
  );
  return (
    <Menu size="small">
      {matches.length === 0 && more.length === 0 && adopted.length === 0 ? (
        <MenuItem disabled text={t("No matching sources.")} />
      ) : null}
      {local.length > 0 ? <MenuDivider title={t("Local")} /> : null}
      {local.map(item)}
      {cloud.length > 0 || adopted.length > 0 ? <MenuDivider title={t("Cloud")} /> : null}
      {cloud.map(item)}
      {adopted.map((source) => (
        <MenuItem
          key={source.id}
          icon={providerIcon(source.id)}
          text={source.label}
          active={source.id === activeId}
          shouldDismissPopover={false}
          labelElement={renderItemRight?.(sourceCatalogEntry(source.id) as ProviderCatalogEntry)}
          onClick={() => onSelect(sourceCatalogEntry(source.id) as ProviderCatalogEntry)}
        />
      ))}
      {more.length > 0 ? <MenuDivider title={t("More providers · published by pi")} /> : null}
      {more.map((source) => (
        <MenuItem
          key={source.id}
          className="ProviderSourcePublished"
          icon={providerIcon(source.id)}
          // pi's own name for its own provider — not ours to translate.
          text={source.label}
          active={source.id === activeId}
          shouldDismissPopover={false}
          label={t("{{count}} models", { count: source.published ?? 0 })}
          onClick={() => onSelect(piCatalogEntry(source.id) as ProviderCatalogEntry)}
        />
      ))}
    </Menu>
  );
}
