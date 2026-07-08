import { Button, Code, Divider, HTMLTable, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiDns, mdiEthernet, mdiInfinity, mdiNetwork, mdiScrewdriver } from "@mdi/js";
import * as ReactIcon from "@mdi/react";
import dayjs from "dayjs";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { Network } from "@/env/Types";
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
  useMergedResources,
  useResourceReload,
  useShowEngineRowAccent,
} from "@/web-app/hooks/useMergedResources";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { compareSortValues, type SortSelectors } from "@/web-app/utils/comparators";

import { ActionsMenu } from ".";
import { useNetworkBulkActions } from "./bulkActions";
import "./ManageScreen.css";
import { getNetworkUrl } from "./Navigation";
import { ScreenHeaderSectionsTabBar } from "./ScreenHeader";

export interface ScreenProps extends AppScreenProps {}

export const ID = "networks";

// Always-merged workspace: rows come from every connected engine, each carrying its engine/connection.
type MergedNetwork = MergedResource<Network>;
interface NetworkConnectionGroup extends ConnectionGroup<MergedNetwork> {
  connection: {
    id: string;
    name: string;
    engine: string;
  };
}

const COLUMN_COUNT = 9;

const createNetworkSearchFilter = (searchTerm: string) => {
  const query = searchTerm.toLowerCase();
  return (network: MergedNetwork) => {
    const haystacks = [network.name, network.id, network.engine, network.connectionName].map((value) =>
      `${value ?? ""}`.toLowerCase(),
    );
    return haystacks.some((value) => value.includes(query));
  };
};

const networkSortSelectors: SortSelectors<MergedNetwork> = {
  engine: (network) => network.engine,
  name: (network) => network.name,
  id: (network) => network.id,
  driver: (network) => network.driver,
  interface: (network) => network.network_interface,
  internal: (network) => network.internal,
  dns: (network) => network.dns_enabled,
  created: (network) =>
    typeof network.created === "string" ? Date.parse(network.created) : Number(network.created) * 1000,
};

export const Screen: AppScreen<ScreenProps> = () => {
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { t } = useTranslation();
  const currentConnector = useAppStore((state) => state.currentConnector);
  const { clientSort, getColumnSortDirection, toggleColumnSort } = useColumnSort(
    ID,
    currentConnector?.capabilities?.sort,
  );
  const networkSnapshot = useMergedResources("networks");
  const filteredNetworks = useMemo(
    () => (searchTerm ? networkSnapshot.filter(createNetworkSearchFilter(searchTerm)) : networkSnapshot),
    [networkSnapshot, searchTerm],
  );
  const compareNetworks = useCallback(
    (a: MergedNetwork, b: MergedNetwork) => {
      if (clientSort) {
        const selector = networkSortSelectors[clientSort.field];
        if (selector) {
          return (clientSort.dir === "asc" ? 1 : -1) * compareSortValues(selector(a), selector(b));
        }
      }
      return sortAlphaNum(a.name, b.name);
    },
    [clientSort],
  );
  const groups = useMemo(() => {
    const byConnection = new Map<string, NetworkConnectionGroup>();
    for (const network of filteredNetworks) {
      let group = byConnection.get(network.connectionId);
      if (!group) {
        group = {
          key: network.connectionId,
          connection: {
            id: network.connectionId,
            name: network.connectionName,
            engine: `${network.engine}`,
          },
          items: [],
        };
        byConnection.set(network.connectionId, group);
      }
      group.items.push(network);
    }
    const list = [...byConnection.values()];
    for (const group of list) {
      group.items.sort(compareNetworks);
    }
    list.sort((a, b) => sortAlphaNum(a.connection.name, b.connection.name));
    return list;
  }, [compareNetworks, filteredNetworks]);
  const networks = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  // Composite selection/React key — ids collide across engines, so qualify each by its connection.
  const getRowId = useCallback((network: MergedNetwork) => mergedKey(network, network.id), []);
  const visibleIds = useMemo(() => networks.map(getRowId), [networks, getRowId]);
  const selection = useBulkSelection(ID, visibleIds);
  const { actions: bulkActions, refresh: bulkRefresh } = useNetworkBulkActions();
  const showEngineRowAccent = useShowEngineRowAccent();
  const { items, paddingTop, paddingBottom, measureRef, scrollElementRef, theadRef, isCollapsed, onGroupToggleClick } =
    useGroupedVirtualRows({ groups, getRowKey: (network) => getRowId(network) });
  // Always-merged: a manual reload refreshes this domain on every connected engine.
  const onReload = useResourceReload("networks");

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader
        searchTerm={searchTerm}
        onSearch={onSearchChange}
        titleIcon={IconNames.HEAT_GRID}
        rightContent={
          <>
            {selection.count > 0 ? (
              <>
                <BulkActionsBar
                  items={networks || []}
                  getId={getRowId}
                  selectedIds={selection.selectedIds}
                  actions={bulkActions}
                  onClear={selection.clear}
                  refresh={bulkRefresh}
                />
                <Divider />
              </>
            ) : null}
            <ActionsMenu
              navigation={<ScreenHeaderSectionsTabBar isActive={(screen) => screen === "networks.manage"} />}
              onReload={onReload}
            />
          </>
        }
      />
      <div className="AppScreenContent" ref={scrollElementRef}>
        {groups.length === 0 ? (
          <NonIdealState
            icon={IconNames.GEOSEARCH}
            title={t("No results")}
            description={<p>{t("There are no networks")}</p>}
          />
        ) : (
          <HTMLTable
            interactive
            compact
            className="AppDataTable GroupedTable"
            data-windowed="true"
            data-table="networks"
          >
            <thead ref={theadRef}>
              <tr>
                <SortableColumnHeader field="name" direction={getColumnSortDirection("name")} onSort={toggleColumnSort}>
                  <AppLabel iconPath={mdiNetwork} text={t("Name")} />
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="id"
                  direction={getColumnSortDirection("id")}
                  onSort={toggleColumnSort}
                  title={t("First 12 characters")}
                >
                  <AppLabel iconName={IconNames.BARCODE} text={t("Id")} />
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="driver"
                  direction={getColumnSortDirection("driver")}
                  onSort={toggleColumnSort}
                >
                  <AppLabel iconPath={mdiScrewdriver} text={t("Driver")} />
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="interface"
                  direction={getColumnSortDirection("interface")}
                  onSort={toggleColumnSort}
                >
                  <AppLabel iconPath={mdiEthernet} text={t("Interface")} />
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="internal"
                  direction={getColumnSortDirection("internal")}
                  onSort={toggleColumnSort}
                >
                  <AppLabel iconPath={mdiInfinity} text={t("Internal")} />
                </SortableColumnHeader>
                <SortableColumnHeader field="dns" direction={getColumnSortDirection("dns")} onSort={toggleColumnSort}>
                  <AppLabel iconPath={mdiDns} text={t("DNS")} />
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
                  const group = descriptor.group as NetworkConnectionGroup;
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
                          title={t("{{name}} networks", { name: group.connection.name })}
                          text={
                            <>
                              <EngineCell engine={group.connection.engine} connectionName={group.connection.name} />
                              <span className="buttonTextLabel">{group.connection.name}</span>
                              <span className="GroupedTableGroupMeta">{engineLabel(group.connection.engine)}</span>
                              <span className="GroupedTableGroupSum">
                                {group.items.length} {group.items.length === 1 ? t("network") : t("networks")}
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
                const network = descriptor.item;
                const rowId = key;
                const linkLocation = descriptor.isFirst ? "first" : descriptor.isLast ? "last" : undefined;
                const creationDate =
                  typeof network.created === "string" ? dayjs(network.created) : dayjs(Number(network.created) * 1000);
                return (
                  <tr
                    key={key}
                    ref={measureRef}
                    data-index={index}
                    data-prefix-group={network.connectionId}
                    data-striped={striped}
                    data-network={network.id}
                    data-engine-row={showEngineRowAccent ? network.engine : undefined}
                  >
                    <td>
                      <div className="AppDataTableGroupLink" data-link-location={linkLocation}>
                        <div className="AppDataTableGroupLinkVertical" />
                        <div className="AppDataTableGroupLinkHorizontal" />
                      </div>
                      <AppDataTableLink
                        className="InspectNetworkButton"
                        fillCell
                        href={getNetworkUrl(network.id, "inspect", network.connectionId)}
                        iconName={IconNames.EYE_OPEN}
                        text={network.name}
                      />
                    </td>
                    <td>
                      <Code title={network.id}>{network.id?.substring(0, 16)}</Code>
                    </td>
                    <td>{network.driver}</td>
                    <td>
                      <Code>{network.network_interface}</Code>
                    </td>
                    <td>{network.internal ? t("Yes") : t("No")}</td>
                    <td>{network.dns_enabled ? t("Yes") : t("No")}</td>
                    <td>{creationDate.format("DD MMM YYYY HH:mm")}</td>
                    <td data-column="Actions">
                      <ActionsMenu withoutCreate network={network} connectionId={network.connectionId} />
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
Screen.Title = "Networks";
Screen.Route = {
  Path: `/screens/${ID}`,
};
Screen.Metadata = {
  LeftIcon: <ReactIcon.Icon className="ReactIcon" path={mdiNetwork} size={0.75} />,
  Tooltip: "Networks and reachability",
};
