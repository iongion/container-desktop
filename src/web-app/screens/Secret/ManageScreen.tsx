import { AnchorButton, Code, Divider, HTMLTable, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import dayjs from "dayjs";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { Connector, Secret } from "@/env/Types";
import { AppLabel } from "@/web-app/components/AppLabel";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { BulkActionsBar, SelectionCheckbox, useBulkSelection } from "@/web-app/components/Bulk";
import { EngineColumnCell, EngineColumnHeader } from "@/web-app/components/EngineCell";
import { SortableColumnHeader } from "@/web-app/components/SortableColumnHeader";
import { sortAlphaNum } from "@/web-app/domain/utils";
import { useColumnSort } from "@/web-app/hooks/useColumnSort";
import {
  type MergedResource,
  mergedKey,
  useMergedResources,
  useResourceReload,
  useShowEngineColumn,
} from "@/web-app/hooks/useMergedResources";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { type SortSelectors, sortByField } from "@/web-app/utils/comparators";

import { SecretActionsMenu } from ".";
import { useSecretBulkActions } from "./bulkActions";
import "./ManageScreen.css";
import { getSecretUrl } from "./Navigation";

export const ID = "secrets";

export interface ScreenProps extends AppScreenProps {}

// Always-merged workspace: rows come from every connected engine, each carrying its engine/connection.
type MergedSecret = MergedResource<Secret>;

const createSecretSearchFilter = (searchTerm: string) => {
  const query = searchTerm.toLowerCase();
  return (secret: MergedSecret) => {
    const haystacks = [
      secret.ID,
      secret.Spec?.Name || "",
      secret.Spec?.Driver?.Name || "",
      secret.engine,
      secret.connectionName,
    ].map((value) => `${value ?? ""}`.toLowerCase());
    return haystacks.some((value) => value.includes(query));
  };
};

const secretSortSelectors: SortSelectors<MergedSecret> = {
  engine: (secret) => secret.engine,
  name: (secret) => secret.Spec?.Name || "",
  id: (secret) => secret.ID,
  updated: (secret) => Date.parse(secret.UpdatedAt || secret.CreatedAt || ""),
  created: (secret) => Date.parse(secret.CreatedAt || ""),
};

export const Screen: AppScreen<ScreenProps> = () => {
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { t } = useTranslation();
  const currentConnector = useAppStore((state) => state.currentConnector);
  const { clientSort, getColumnSortDirection, toggleColumnSort } = useColumnSort(
    ID,
    currentConnector?.capabilities?.sort,
  );
  const secretSnapshot = useMergedResources("secrets");
  const secrets = useMemo(() => {
    const items = searchTerm ? secretSnapshot.filter(createSecretSearchFilter(searchTerm)) : secretSnapshot;
    return clientSort
      ? sortByField(items, clientSort, secretSortSelectors)
      : [...items].sort((a, b) => sortAlphaNum(a.Spec?.Name || "", b.Spec?.Name || ""));
  }, [clientSort, secretSnapshot, searchTerm]);
  // Composite selection/React key — ids collide across engines, so qualify each by its connection.
  const getRowId = useCallback((s: MergedSecret) => mergedKey(s, s.ID), []);
  const visibleIds = useMemo(() => secrets.map(getRowId), [secrets, getRowId]);
  const selection = useBulkSelection(ID, visibleIds);
  const { actions: bulkActions, refresh: bulkRefresh } = useSecretBulkActions();
  const showEngineColumn = useShowEngineColumn();
  // Always-merged: a manual reload refreshes this domain on every connected engine.
  const onReload = useResourceReload("secrets");

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader
        searchTerm={searchTerm}
        onSearch={onSearchChange}
        titleIcon={IconNames.KEY}
        rightContent={
          <>
            {selection.count > 0 ? (
              <>
                <BulkActionsBar
                  items={secrets}
                  getId={getRowId}
                  selectedIds={selection.selectedIds}
                  actions={bulkActions}
                  onClear={selection.clear}
                  refresh={bulkRefresh}
                />
                <Divider />
              </>
            ) : null}
            <SecretActionsMenu onReload={onReload} />
          </>
        }
      />
      <div className="AppScreenContent">
        {secrets.length === 0 ? (
          <NonIdealState
            icon={IconNames.GEOSEARCH}
            title={t("No results")}
            description={<p>{t("There are no secrets")}</p>}
          />
        ) : (
          <HTMLTable interactive compact striped className="AppDataTable" data-table="secrets">
            <thead>
              <tr>
                <SortableColumnHeader field="name" direction={getColumnSortDirection("name")} onSort={toggleColumnSort}>
                  <AppLabel iconName={IconNames.KEY} text={t("Name")} />
                </SortableColumnHeader>
                <SortableColumnHeader field="id" direction={getColumnSortDirection("id")} onSort={toggleColumnSort}>
                  <AppLabel iconName={IconNames.BARCODE} text={t("Id")} />
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="updated"
                  direction={getColumnSortDirection("updated")}
                  onSort={toggleColumnSort}
                >
                  <AppLabel iconName={IconNames.CALENDAR} text={t("Updated")} />
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="created"
                  direction={getColumnSortDirection("created")}
                  onSort={toggleColumnSort}
                >
                  <AppLabel iconName={IconNames.CALENDAR} text={t("Created")} />
                </SortableColumnHeader>
                <th data-column="Actions">&nbsp;</th>
                <th data-column="select" className="BulkSelectColumn">
                  <SelectionCheckbox
                    checked={selection.headerState.checked}
                    indeterminate={selection.headerState.indeterminate}
                    onChange={selection.toggleAll}
                    title={t("Select all")}
                  />
                </th>
                <EngineColumnHeader visible={showEngineColumn} />
              </tr>
            </thead>
            <tbody>
              {secrets.map((secret) => {
                const rowId = getRowId(secret);
                return (
                  <tr key={rowId} data-engine-row={showEngineColumn ? secret.engine : undefined}>
                    <td>
                      <AnchorButton
                        className="PodDetailsButton"
                        variant="minimal"
                        size="small"
                        href={getSecretUrl(secret.ID, "inspect", secret.connectionId)}
                        text={secret.Spec.Name}
                        intent={Intent.PRIMARY}
                        icon={IconNames.EYE_OPEN}
                      />
                    </td>
                    <td>
                      <Code>{secret.ID}</Code>
                    </td>
                    <td>{(dayjs(secret.CreatedAt) as any).fromNow()}</td>
                    <td>{(dayjs(secret.CreatedAt) as any).fromNow()}</td>
                    <td>
                      <SecretActionsMenu withoutCreate secret={secret} connectionId={secret.connectionId} />
                    </td>
                    <td className="BulkSelectColumn">
                      <SelectionCheckbox
                        checked={selection.isSelected(rowId)}
                        onChange={() => selection.toggle(rowId)}
                      />
                    </td>
                    <EngineColumnCell
                      visible={showEngineColumn}
                      engine={secret.engine}
                      connectionName={secret.connectionName}
                    />
                  </tr>
                );
              })}
            </tbody>
          </HTMLTable>
        )}
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Secrets";
Screen.Route = {
  Path: `/screens/${ID}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.KEY,
};
Screen.isAvailable = (currentConnector?: Connector) => {
  return currentConnector?.capabilities?.resources.secrets === true;
};
