import {
  Button,
  Drawer,
  DrawerSize,
  HTMLSelect,
  HTMLTable,
  InputGroup,
  Intent,
  NonIdealState,
  Spinner,
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useMemo, useState } from "react";

import type { Registry, RegistrySearchResult } from "@/env/Types";
import { t } from "@/web-app/App.i18n";
import { useSearchRegistry } from "./queries";
import { SearchResultDrawer } from "./SearchResultDrawer";
import { useConnectionRegistryGroups } from "./trustQueries";

// Search images across a chosen registry (Docker Hub etc.). Reuses the registry search mutation (mock-backed
// by the generated image catalog) and the existing pull drawer, so it works end-to-end in mock.
export function SearchImagesDrawer({ onClose }: { onClose: () => void }) {
  const { data: groups = [] } = useConnectionRegistryGroups();
  // Unique searchable registries across every connection (by name), so the user can pick where to search.
  const registries = useMemo(() => {
    const byName = new Map<string, Registry>();
    for (const group of groups) {
      for (const registry of group.registries) {
        if (!byName.has(registry.name)) {
          byName.set(registry.name, registry);
        }
      }
    }
    return [...byName.values()];
  }, [groups]);
  const [registryName, setRegistryName] = useState("");
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<RegistrySearchResult | undefined>();
  const search = useSearchRegistry();
  const results = search.data ?? [];
  const activeRegistry = registries.find((r) => r.name === registryName) ?? registries[0];

  const runSearch = () => {
    if (activeRegistry && term.trim()) {
      search.mutate({ term: term.trim(), registry: activeRegistry, filters: {} });
    }
  };

  return (
    <Drawer
      isOpen
      className="AppDrawer"
      size={DrawerSize.LARGE}
      icon={IconNames.SEARCH}
      title={t("Search images")}
      onClose={onClose}
    >
      <div className="TrustPanelWrap SearchImagesWrap">
        <div className="SearchImagesBar">
          <HTMLSelect
            value={activeRegistry?.name ?? ""}
            onChange={(e) => setRegistryName(e.currentTarget.value)}
            disabled={registries.length === 0}
          >
            {registries.map((registry) => (
              <option key={registry.name} value={registry.name}>
                {registry.name}
              </option>
            ))}
          </HTMLSelect>
          <InputGroup
            fill
            leftIcon={IconNames.SEARCH}
            placeholder={t("Image name, e.g. nginx")}
            value={term}
            autoFocus
            onChange={(e) => setTerm(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                runSearch();
              }
            }}
          />
          <Button
            intent={Intent.PRIMARY}
            icon={IconNames.SEARCH}
            text={t("Search")}
            disabled={!term.trim() || !activeRegistry}
            onClick={runSearch}
          />
        </div>

        {search.isPending ? (
          <NonIdealState title={<Spinner size={28} />} description={t("Searching…")} />
        ) : results.length === 0 ? (
          <NonIdealState
            icon={IconNames.GEOSEARCH}
            title={search.isSuccess ? t("No results") : t("Search images")}
            description={search.isSuccess ? t("Nothing matched — refine the term") : t("Type a term and search")}
          />
        ) : (
          <HTMLTable compact striped interactive className="AppDataTable" data-table="trust.image-search">
            <thead>
              <tr>
                <th>{t("Image")}</th>
                <th>{t("Registry")}</th>
                <th>{t("Stars")}</th>
                <th data-column="Actions">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result) => (
                <tr key={`${result.Index}/${result.Name}`}>
                  <td>{result.Name.replace(`${result.Index}/`, "")}</td>
                  <td>{result.Index}</td>
                  <td>{result.Stars}</td>
                  <td data-column="Actions">
                    <Button
                      variant="minimal"
                      size="small"
                      icon={IconNames.IMPORT}
                      text={t("Pull")}
                      onClick={() => setSelected(result)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </HTMLTable>
        )}
      </div>
      {selected ? <SearchResultDrawer searchResult={selected} onClose={() => setSelected(undefined)} /> : null}
    </Drawer>
  );
}
