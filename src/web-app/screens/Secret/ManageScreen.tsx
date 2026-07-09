import { Button, Code, Divider, HTMLTable, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import dayjs from "dayjs";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { Connector, Secret } from "@/env/Types";
import i18n from "@/i18n";
import { AppDataTableLink } from "@/web-app/components/AppDataTableLink";
import { AppLabel } from "@/web-app/components/AppLabel";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { BulkActionsBar, SelectionCheckbox, useBulkSelection } from "@/web-app/components/Bulk";
import { EngineCell, engineLabel } from "@/web-app/components/EngineCell";
import type { ConnectionGroup } from "@/web-app/components/groupedTable/flattenConnectionGroups";
import { useGroupedVirtualRows } from "@/web-app/components/groupedTable/useGroupedVirtualRows";
import { SortableColumnHeader } from "@/web-app/components/SortableColumnHeader";
import { VirtualSpacerRow } from "@/web-app/components/VirtualSpacerRow";
import { sortAlphaNum } from "@/web-app/domain/utils";
import { useColumnSort } from "@/web-app/hooks/useColumnSort";
import {
  type MergedResource,
  mergedKey,
  useGroupByConnection,
  useMergedResources,
  useResourceReload,
  useShowEngineRowAccent,
} from "@/web-app/hooks/useMergedResources";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { compareSortValues, type SortSelectors } from "@/web-app/utils/comparators";

import { SecretActionsMenu } from ".";
import { useSecretBulkActions } from "./bulkActions";
import "./ManageScreen.css";
import { getSecretUrl } from "./Navigation";

export const ID = "secrets";

export interface ScreenProps extends AppScreenProps {}

// Always-merged workspace: rows come from every connected engine, each carrying its engine/connection.
type MergedSecret = MergedResource<Secret>;
interface SecretConnectionGroup extends ConnectionGroup<MergedSecret> {
  connection: {
    id: string;
    name: string;
    engine: string;
  };
}

const COLUMN_COUNT = 6;

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
  const filteredSecrets = useMemo(
    () => (searchTerm ? secretSnapshot.filter(createSecretSearchFilter(searchTerm)) : secretSnapshot),
    [secretSnapshot, searchTerm],
  );
  const compareSecrets = useCallback(
    (a: MergedSecret, b: MergedSecret) => {
      if (clientSort) {
        const selector = secretSortSelectors[clientSort.field];
        if (selector) {
          return (clientSort.dir === "asc" ? 1 : -1) * compareSortValues(selector(a), selector(b));
        }
      }
      return sortAlphaNum(a.Spec?.Name || "", b.Spec?.Name || "");
    },
    [clientSort],
  );
  const grouped = useGroupByConnection();
  const groups = useMemo(() => {
    const byConnection = new Map<string, SecretConnectionGroup>();
    for (const secret of filteredSecrets) {
      let group = byConnection.get(secret.connectionId);
      if (!group) {
        group = {
          key: secret.connectionId,
          connection: {
            id: secret.connectionId,
            name: secret.connectionName,
            engine: `${secret.engine}`,
          },
          items: [],
        };
        byConnection.set(secret.connectionId, group);
      }
      group.items.push(secret);
    }
    const list = [...byConnection.values()];
    for (const group of list) {
      group.items.sort(compareSecrets);
    }
    list.sort((a, b) => sortAlphaNum(a.connection.name, b.connection.name));
    return list;
  }, [compareSecrets, filteredSecrets]);
  const secrets = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  // Composite selection/React key — ids collide across engines, so qualify each by its connection.
  const getRowId = useCallback((s: MergedSecret) => mergedKey(s, s.ID), []);
  const visibleIds = useMemo(() => secrets.map(getRowId), [secrets, getRowId]);
  const selection = useBulkSelection(ID, visibleIds);
  const { actions: bulkActions, refresh: bulkRefresh } = useSecretBulkActions();
  const showEngineRowAccent = useShowEngineRowAccent();
  const { items, paddingTop, paddingBottom, measureRef, scrollElementRef, theadRef, isCollapsed, onGroupToggleClick } =
    useGroupedVirtualRows({ groups, getRowKey: (secret) => getRowId(secret), grouped, flatSort: compareSecrets });
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
      <div className="AppScreenContent" ref={scrollElementRef}>
        {groups.length === 0 ? (
          <NonIdealState
            icon={IconNames.GEOSEARCH}
            title={t("No results")}
            description={<p>{t("There are no secrets")}</p>}
          />
        ) : (
          <HTMLTable
            interactive
            compact
            className="AppDataTable GroupedTable"
            data-windowed="true"
            data-table="secrets"
            data-grouped={grouped ? "true" : "false"}
          >
            <thead ref={theadRef}>
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
              </tr>
            </thead>
            <tbody>
              <VirtualSpacerRow height={paddingTop} columnCount={COLUMN_COUNT} />
              {items.map(({ row: descriptor, index, key }) => {
                const striped = index % 2 === 0 ? "true" : undefined;
                if (descriptor.kind === "group-header") {
                  const group = descriptor.group as SecretConnectionGroup;
                  const collapsed = isCollapsed(group.key);
                  const groupIds = group.items.map(getRowId);
                  const groupSelectedCount = groupIds.reduce((n, id) => n + (selection.isSelected(id) ? 1 : 0), 0);
                  const groupChecked = groupIds.length > 0 && groupSelectedCount === groupIds.length;
                  const groupIndeterminate = groupSelectedCount > 0 && groupSelectedCount < groupIds.length;
                  return (
                    <tr
                      key={key}
                      ref={measureRef}
                      data-index={index}
                      data-striped={striped}
                      className="AppDataTableGroupRow"
                      data-engine-row={showEngineRowAccent ? group.connection.engine : undefined}
                    >
                      <td className="AppDataTableGroupName" colSpan={COLUMN_COUNT - 1}>
                        <Button
                          variant="minimal"
                          icon={collapsed ? IconNames.CARET_RIGHT : IconNames.CARET_DOWN}
                          onClick={onGroupToggleClick}
                          data-prefix-group={group.key}
                          title={t("{{name}} secrets", { name: group.connection.name })}
                          text={
                            <>
                              <EngineCell engine={group.connection.engine} connectionName={group.connection.name} />
                              <span className="buttonTextLabel">{group.connection.name}</span>
                              <span className="GroupedTableGroupMeta">{engineLabel(group.connection.engine)}</span>
                              <span className="GroupedTableGroupSum">
                                {group.items.length} {group.items.length === 1 ? t("secret") : t("secrets")}
                              </span>
                            </>
                          }
                        />
                      </td>
                      <td className="BulkSelectColumn">
                        <SelectionCheckbox
                          checked={groupChecked}
                          indeterminate={groupIndeterminate}
                          onChange={() => selection.toggleMany(groupIds)}
                          title={t("Select all in group")}
                        />
                      </td>
                    </tr>
                  );
                }
                const secret = descriptor.item;
                const rowId = key;
                const linkLocation = descriptor.isFirst ? "first" : descriptor.isLast ? "last" : undefined;
                return (
                  <tr
                    key={key}
                    ref={measureRef}
                    data-index={index}
                    data-prefix-group={secret.connectionId}
                    data-striped={striped}
                    data-engine-row={showEngineRowAccent ? secret.engine : undefined}
                  >
                    <td>
                      <div className="AppDataTableGroupLink" data-link-location={linkLocation}>
                        <div className="AppDataTableGroupLinkVertical" />
                        <div className="AppDataTableGroupLinkHorizontal" />
                      </div>
                      <AppDataTableLink
                        className="PodDetailsButton"
                        fillCell
                        href={getSecretUrl(secret.ID, "inspect", secret.connectionId)}
                        text={secret.Spec.Name}
                        iconName={IconNames.EYE_OPEN}
                      />
                    </td>
                    <td>
                      <Code>{secret.ID}</Code>
                    </td>
                    <td>{(dayjs(secret.CreatedAt) as any).fromNow()}</td>
                    <td>{(dayjs(secret.CreatedAt) as any).fromNow()}</td>
                    <td data-column="Actions">
                      <SecretActionsMenu withoutCreate secret={secret} connectionId={secret.connectionId} />
                    </td>
                    <td className="BulkSelectColumn">
                      <SelectionCheckbox
                        checked={selection.isSelected(rowId)}
                        onChange={() => selection.toggle(rowId)}
                      />
                    </td>
                  </tr>
                );
              })}
              <VirtualSpacerRow height={paddingBottom} columnCount={COLUMN_COUNT} />
            </tbody>
          </HTMLTable>
        )}
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = i18n.t("Secrets");
Screen.Route = {
  Path: `/screens/${ID}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.KEY,
};
Screen.isAvailable = (currentConnector?: Connector) => {
  return currentConnector?.capabilities?.resources.secrets === true;
};
