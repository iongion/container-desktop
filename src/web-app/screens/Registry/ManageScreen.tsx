import { Button, HTMLTable, Intent, NonIdealState, Radio, Spinner } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiCubeUnfolded } from "@mdi/js";
import * as ReactIcon from "@mdi/react";
import { type FormEvent, type MouseEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { RegistrySearchFilters, RegistrySearchResult } from "@/env/Types";
import { AppLabel } from "@/web-app/components/AppLabel";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { useStoreActions, useStoreState } from "@/web-app/domain/types";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ActionsMenu, ScreenHeader } from ".";
import "./ManageScreen.css";
import { SearchResultDrawer } from "./SearchResultDrawer";

export interface ScreenProps extends AppScreenProps {}

export const ID = "registries";

export const Screen: AppScreen<ScreenProps> = () => {
  const term = useStoreState((actions) => actions.registry.term);
  const { searchTerm, onSearchChange } = useAppScreenSearch(term);
  const { t } = useTranslation();
  const registriesMap = useStoreState((state) => state.registry.registriesMap);
  const searchResults = useStoreState((state) => state.registry.searchResults);
  const currentConnector = useStoreState((state) => state.currentConnector);
  const registriesFetch = useStoreActions((actions) => actions.registry.registriesFetch);
  const registrySearch = useStoreActions((actions) => actions.registry.registrySearch);
  const registries = useMemo(
    () => [...(registriesMap?.default || []), ...(registriesMap?.custom || [])],
    [registriesMap],
  );
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
          await registrySearch({ term: searchTerm, registry, filters });
        } else {
          console.warn("No registry", selectedRegistry);
        }
      } catch (error: any) {
        console.error("Error looking up", error);
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

  useEffect(() => {
    registriesFetch();
  }, [registriesFetch]);

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
          <HTMLTable interactive compact striped className="AppDataTable" data-table="search.results">
            <thead>
              <tr>
                <th data-column="Name">
                  <AppLabel iconName={IconNames.BOX} text={t("Image")} />
                </th>
                <th data-column="Registry">
                  <AppLabel iconPath={mdiCubeUnfolded} text={t("Registry")} />
                </th>
                <th data-column="Stars">
                  <AppLabel iconName={IconNames.STAR} />
                </th>
              </tr>
            </thead>
            <tbody>
              {searchResults.map((it) => {
                return (
                  <tr key={`${it.Index}_${it.Name}_${it.Tag}`} data-registry={it.Name}>
                    <td>
                      <Button
                        className="RegistrySearchResultButton"
                        minimal
                        small
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
        <div className="AppScreenContentView" data-column="left">
          {content}
        </div>
        <div className="AppScreenContentView" data-column="right">
          <HTMLTable compact striped className="AppDataTable" data-table="registries">
            <thead>
              <tr>
                <th data-column="name">
                  <div className="RegistriesTableHeader">
                    <AppLabel iconName={IconNames.SEARCH} text={t("Look-up source")} />
                  </div>
                </th>
                <th data-column="Actions">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {(registries || []).map((registry) => {
                let title = "";
                if (registry.id === "system") {
                  title = registry.enabled
                    ? t("Podman registry.conf file must be adjusted - it allows parallel search")
                    : t("Not available for current host");
                }
                const isUsable = currentConnector?.engine ? registry.engine.includes(currentConnector?.engine) : false;
                return (
                  <tr key={registry.id} data-registry={registry.id}>
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
                    <td>
                      <ActionsMenu withoutCreate registry={registry} />
                    </td>
                  </tr>
                );
              })}
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
