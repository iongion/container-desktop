import { Button, HTMLTable, Intent, NonIdealState, Radio, Spinner } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiCubeUnfolded } from "@mdi/js";
import * as ReactIcon from "@mdi/react";
import { type FormEvent, type MouseEvent, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Registry, RegistrySearchFilters, RegistrySearchResult } from "@/env/Types";
import { AppLabel } from "@/web-app/components/AppLabel";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { SortableColumnHeader } from "@/web-app/components/SortableColumnHeader";
import { VirtualSpacerRow } from "@/web-app/components/VirtualSpacerRow";
import { useColumnSort } from "@/web-app/hooks/useColumnSort";
import { useTableScroll, useWindowedRows } from "@/web-app/hooks/useWindowedRows";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { type SortSelectors, sortByField } from "@/web-app/utils/comparators";

import { ActionsMenu, ScreenHeader } from ".";
import "./ManageScreen.css";
import { createLogger } from "@/logger";
import { useRegistriesMap, useSearchRegistry } from "./queries";
import { SearchResultDrawer } from "./SearchResultDrawer";

const logger = createLogger("web.registry");

export interface ScreenProps extends AppScreenProps {}

export const ID = "registries";

const registrySearchSortSelectors: SortSelectors<RegistrySearchResult> = {
  name: (result) => result.Name,
  registry: (result) => result.Index,
  stars: (result) => result.Stars,
};

const registrySourceSortSelectors: SortSelectors<Registry> = {
  name: (registry) => registry.name,
};

export const Screen: AppScreen<ScreenProps> = () => {
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { t } = useTranslation();
  const currentConnector = useAppStore((state) => state.currentConnector);
  const connectionId = currentConnector?.id || "";
  const searchSort = useColumnSort(`${ID}.search`, currentConnector?.capabilities?.sort);
  const sourceSort = useColumnSort(`${ID}.sources`, currentConnector?.capabilities?.sort);
  const registriesQuery = useRegistriesMap(connectionId);
  const registrySearch = useSearchRegistry();
  const registriesMap = registriesQuery.data || { default: [], custom: [] };
  const searchResults = registrySearch.data || [];
  const registries = useMemo(
    () => [...(registriesMap?.default || []), ...(registriesMap?.custom || [])],
    [registriesMap],
  );
  const sortedSearchResults = useMemo(
    () => sortByField(searchResults, searchSort.clientSort, registrySearchSortSelectors),
    [searchResults, searchSort.clientSort],
  );
  const sortedRegistries = useMemo(
    () => sortByField(registries, sourceSort.clientSort, registrySourceSortSelectors),
    [registries, sourceSort.clientSort],
  );
  // Two independent scroll containers (left = search results, right = sources), each windowed. Distinct
  // scrollKeys so their remembered scroll offsets don't collide on the shared route.
  const searchScroll = useTableScroll();
  const sourcesScroll = useTableScroll();
  const searchWindow = useWindowedRows({
    rows: sortedSearchResults,
    getScrollElement: searchScroll.getScrollElement,
    getRowKey: (result) => `${result.Index}_${result.Name}_${result.Tag}`,
    scrollMargin: searchScroll.scrollMargin,
    enabled: sortedSearchResults.length > 0,
    scrollKey: "search",
  });
  const sourcesWindow = useWindowedRows({
    rows: sortedRegistries,
    getScrollElement: sourcesScroll.getScrollElement,
    getRowKey: (registry) => registry.id,
    scrollMargin: sourcesScroll.scrollMargin,
    enabled: sortedRegistries.length > 0,
    scrollKey: "sources",
  });
  const [state, setState] = useState(searchResults.length ? "state.looked-up" : "state.initial");
  const firstEnabledRegistry = useMemo(
    () =>
      registries.find((it) => it.enabled && currentConnector?.engine && it.engine.includes(currentConnector?.engine)),
    [currentConnector, registries],
  );
  const [currentRegistry, setCurrentRegistry] = useState<string | undefined>(firstEnabledRegistry?.name);
  const [searchResult, setSearchResult] = useState<RegistrySearchResult>();

  const selectedRegistry = currentRegistry ? currentRegistry : firstEnabledRegistry?.name;

  const onSearchTrigger = useCallback(
    async (filters: RegistrySearchFilters, event: MouseEvent<HTMLElement, MouseEvent>) => {
      setState("state.looking-up");
      const registry = registries.find((it) => it.name === selectedRegistry);
      try {
        if (registry) {
          await registrySearch.mutateAsync({ term: searchTerm, registry, filters });
        } else {
          logger.warn("No registry", selectedRegistry);
        }
      } catch (error: any) {
        logger.error("Error looking up", error);
      } finally {
        setState("state.looked-up");
      }
    },
    [registries, searchTerm, registrySearch, selectedRegistry],
  );

  const onRegistrySearchResultClick = useCallback(async (it: RegistrySearchResult) => {
    setSearchResult(it);
  }, []);

  const onCurrentRegistryChange = useCallback(
    (e: FormEvent<HTMLInputElement>) => {
      const registry = registries.find((it) => it.name === e.currentTarget.value);
      setCurrentRegistry(registry?.name);
    },
    [registries],
  );

  let content: React.ReactNode | null = null;
  switch (state) {
    case "state.initial":
      content = (
        <NonIdealState
          icon={IconNames.GEOSEARCH}
          title={t("Search not started")}
          description={<p>{t("Type a term and click Search")}</p>}
        />
      );
      break;
    case "state.no-results":
      content = (
        <NonIdealState
          icon={IconNames.LIST}
          title={t("No results")}
          description={<p>{t("Nothing could be found matching current filters, refine and retry")}</p>}
        />
      );
      break;
    case "state.looking-up":
      content = <NonIdealState title={<Spinner size={48} />} description={<p>{t("Looking up")}</p>} />;
      break;
    case "state.looked-up":
      content =
        searchResults.length === 0 ? (
          <NonIdealState
            icon={IconNames.LIST}
            title={t("No results")}
            description={<p>{t("Nothing could be found matching current filters, refine and retry")}</p>}
          />
        ) : (
          <HTMLTable interactive compact className="AppDataTable" data-windowed="true" data-table="search.results">
            <thead ref={searchScroll.theadRef}>
              <tr>
                <SortableColumnHeader
                  field="name"
                  direction={searchSort.getColumnSortDirection("name")}
                  onSort={searchSort.toggleColumnSort}
                >
                  <AppLabel iconName={IconNames.BOX} text={t("Image")} />
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="registry"
                  direction={searchSort.getColumnSortDirection("registry")}
                  onSort={searchSort.toggleColumnSort}
                >
                  <AppLabel iconPath={mdiCubeUnfolded} text={t("Registry")} />
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="stars"
                  direction={searchSort.getColumnSortDirection("stars")}
                  onSort={searchSort.toggleColumnSort}
                >
                  <AppLabel iconName={IconNames.STAR} />
                </SortableColumnHeader>
              </tr>
            </thead>
            <tbody>
              <VirtualSpacerRow height={searchWindow.paddingTop} columnCount={3} />
              {searchWindow.items.map(({ row: it, index, key }) => {
                return (
                  <tr
                    key={key}
                    ref={searchWindow.measureRef}
                    data-index={index}
                    data-striped={index % 2 === 0 ? "true" : undefined}
                    data-registry={it.Name}
                  >
                    <td>
                      <Button
                        className="RegistrySearchResultButton"
                        variant="minimal"
                        size="small"
                        intent={Intent.PRIMARY}
                        icon={IconNames.LIST_DETAIL_VIEW}
                        onClick={() => onRegistrySearchResultClick(it)}
                      >
                        {it.Name.replace(`${it.Index}/`, "")}
                      </Button>
                    </td>
                    <td>
                      <span>{it.Index}</span>
                    </td>
                    <td>
                      <span>{it.Stars}</span>
                    </td>
                  </tr>
                );
              })}
              <VirtualSpacerRow height={searchWindow.paddingBottom} columnCount={3} />
            </tbody>
          </HTMLTable>
        );
      break;
    default:
      break;
  }

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader
        searchTerm={searchTerm}
        onSearch={onSearchChange}
        onSearchTrigger={onSearchTrigger}
        withSearchTrigger
        rightContent={<ActionsMenu />}
      />
      <div className="AppScreenContent">
        <div className="AppScreenContentView" data-column="left" ref={searchScroll.scrollElementRef}>
          {content}
        </div>
        <div className="AppScreenContentView" data-column="right" ref={sourcesScroll.scrollElementRef}>
          <HTMLTable compact className="AppDataTable" data-windowed="true" data-table="registries">
            <thead ref={sourcesScroll.theadRef}>
              <tr>
                <SortableColumnHeader
                  field="name"
                  direction={sourceSort.getColumnSortDirection("name")}
                  onSort={sourceSort.toggleColumnSort}
                >
                  <div className="RegistriesTableHeader">
                    <AppLabel iconName={IconNames.SEARCH} text={t("Look-up source")} />
                  </div>
                </SortableColumnHeader>
                <th data-column="Actions">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              <VirtualSpacerRow height={sourcesWindow.paddingTop} columnCount={2} />
              {sourcesWindow.items.map(({ row: registry, index, key }) => {
                let title = "";
                if (registry.id === "system") {
                  title = registry.enabled
                    ? t("Podman registry.conf file must be adjusted - it allows parallel search")
                    : t("Not available for current host");
                }
                const isUsable = currentConnector?.engine ? registry.engine.includes(currentConnector?.engine) : false;
                return (
                  <tr
                    key={key}
                    ref={sourcesWindow.measureRef}
                    data-index={index}
                    data-striped={index % 2 === 0 ? "true" : undefined}
                    data-registry={registry.id}
                  >
                    <td title={title}>
                      <Radio
                        className="CurrentRegistryRadio"
                        labelElement={registry.isRemovable ? registry.name : <strong>{registry.name}</strong>}
                        value={registry.name}
                        onChange={onCurrentRegistryChange}
                        radioGroup="currentRegistryGroup"
                        checked={registry.name === selectedRegistry}
                        disabled={!registry.enabled || !isUsable}
                      />
                    </td>
                    <td data-column="Actions">
                      <ActionsMenu withoutCreate registry={registry} />
                    </td>
                  </tr>
                );
              })}
              <VirtualSpacerRow height={sourcesWindow.paddingBottom} columnCount={2} />
            </tbody>
          </HTMLTable>
        </div>
        {searchResult && <SearchResultDrawer searchResult={searchResult} onClose={() => setSearchResult(undefined)} />}
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Registries";
Screen.Route = {
  Path: `/screens/${ID}`,
};
Screen.Metadata = {
  LeftIcon: <ReactIcon.Icon className="ReactIcon" path={mdiCubeUnfolded} size={0.75} />,
};
