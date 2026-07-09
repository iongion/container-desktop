import { Button, Divider, HTMLTable, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useQueries } from "@tanstack/react-query";
import dayjs from "dayjs";
import prettyBytes from "pretty-bytes";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { Connector, PodmanMachine } from "@/env/Types";
import i18n from "@/i18n";
import { AppDataTableLink } from "@/web-app/components/AppDataTableLink";
import { AppLabel } from "@/web-app/components/AppLabel";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { BulkActionsBar, SelectionCheckbox, useBulkSelection } from "@/web-app/components/Bulk";
import { connectedConnections, isPodmanConnection } from "@/web-app/components/ConnectionSelect";
import { EngineCell, engineLabel } from "@/web-app/components/EngineCell";
import type { ConnectionGroup } from "@/web-app/components/groupedTable/flattenConnectionGroups";
import { useGroupedVirtualRows } from "@/web-app/components/groupedTable/useGroupedVirtualRows";
import { SortableColumnHeader } from "@/web-app/components/SortableColumnHeader";
import { VirtualSpacerRow } from "@/web-app/components/VirtualSpacerRow";
import { resolveConnectionHost } from "@/web-app/domain/engineHost";
import { liveQueryOptions } from "@/web-app/domain/queryClient";
import { sortAlphaNum } from "@/web-app/domain/utils";
import { useColumnSort } from "@/web-app/hooks/useColumnSort";
import {
  type MergedResource,
  mergedKey,
  useGroupByConnection,
  useShowEngineRowAccent,
} from "@/web-app/hooks/useMergedResources";
import { useAppStore } from "@/web-app/stores/appStore";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { compareSortValues, type SortSelectors } from "@/web-app/utils/comparators";

import { ActionsMenu } from ".";
import { useMachineBulkActions } from "./bulkActions";
import "./ManageScreen.css";
import { getMachineUrl } from "./Navigation";
import { machineKeys } from "./queries";

export const ID = "machines";

export interface ScreenProps extends AppScreenProps {}

const EMPTY_MACHINES: PodmanMachine[] = [];
type MergedMachine = MergedResource<PodmanMachine>;
interface MachineConnectionGroup extends ConnectionGroup<MergedMachine> {
  connection: {
    id: string;
    name: string;
    engine: string;
  };
}

const COLUMN_COUNT = 11;

const createMachineSearchFilter = (searchTerm: string) => {
  const query = searchTerm.toLowerCase();
  return (machine: MergedMachine) => {
    const haystacks = [machine.Name, machine.VMType, machine.engine, machine.connectionName].map((value) =>
      `${value ?? ""}`.toLowerCase(),
    );
    return haystacks.some((value) => value.includes(query));
  };
};

const machineSortSelectors: SortSelectors<MergedMachine> = {
  engine: (machine) => machine.engine,
  name: (machine) => machine.Name,
  vmType: (machine) => machine.VMType,
  cpus: (machine) => Number(machine.CPUs) || 0,
  memory: (machine) => Number(machine.Memory) || 0,
  diskSize: (machine) => Number(machine.DiskSize) || 0,
  default: (machine) => machine.Default,
  running: (machine) => machine.Running,
  lastUp: (machine) => Date.parse(machine.LastUp || ""),
  created: (machine) => Date.parse(machine.Created || ""),
};

export const Screen: AppScreen<ScreenProps> = () => {
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { t } = useTranslation();
  const currentConnector = useAppStore((state) => state.currentConnector);
  const connections = useAppStore((state) => state.connections);
  const activeRuntime = useResourceStore((state) => state.activeRuntime);
  const machineRuntime = useMemo(
    () => activeRuntime.find((info) => info.running && info.capabilities?.extensions?.machines === true),
    [activeRuntime],
  );
  const { clientSort, getColumnSortDirection, toggleColumnSort } = useColumnSort(
    ID,
    machineRuntime?.capabilities?.sort,
  );
  const machineRuntimeIds = useMemo(
    () =>
      new Set(
        activeRuntime
          .filter((info) => info.running && info.capabilities?.extensions?.machines === true)
          .map((info) => info.id),
      ),
    [activeRuntime],
  );
  const machineConnections = useMemo(
    () =>
      connectedConnections(
        connections,
        activeRuntime,
        (connection) => isPodmanConnection(connection) && machineRuntimeIds.has(connection.id),
      ),
    [activeRuntime, connections, machineRuntimeIds],
  );
  const machineQueries = useQueries({
    queries: machineConnections.map((connection) => ({
      queryKey: machineKeys.list(connection.id),
      queryFn: async () => {
        const host = await resolveConnectionHost(connection.id);
        if (!host) {
          throw new Error("No active engine connection");
        }
        return host.getPodmanMachines();
      },
      enabled: !!connection.id,
      ...liveQueryOptions(),
    })),
  });
  const machineSnapshot = useMemo<MergedMachine[]>(
    () =>
      machineConnections.flatMap((connection, index) =>
        (machineQueries[index]?.data ?? EMPTY_MACHINES).map((machine) => ({
          ...machine,
          engine: connection.engine,
          connectionId: connection.id,
          connectionName: connection.name,
        })),
      ),
    [machineConnections, machineQueries],
  );
  const filteredMachines = useMemo(
    () => (searchTerm ? machineSnapshot.filter(createMachineSearchFilter(searchTerm)) : machineSnapshot),
    [machineSnapshot, searchTerm],
  );
  const compareMachines = useCallback(
    (a: MergedMachine, b: MergedMachine) => {
      if (clientSort) {
        const selector = machineSortSelectors[clientSort.field];
        if (selector) {
          return (clientSort.dir === "asc" ? 1 : -1) * compareSortValues(selector(a), selector(b));
        }
      }
      return sortAlphaNum(a.Name, b.Name);
    },
    [clientSort],
  );
  const grouped = useGroupByConnection();
  const groups = useMemo(() => {
    const byConnection = new Map<string, MachineConnectionGroup>();
    for (const machine of filteredMachines) {
      let group = byConnection.get(machine.connectionId);
      if (!group) {
        group = {
          key: machine.connectionId,
          connection: {
            id: machine.connectionId,
            name: machine.connectionName,
            engine: `${machine.engine}`,
          },
          items: [],
        };
        byConnection.set(machine.connectionId, group);
      }
      group.items.push(machine);
    }
    const list = [...byConnection.values()];
    for (const group of list) {
      group.items.sort(compareMachines);
    }
    list.sort((a, b) => sortAlphaNum(a.connection.name, b.connection.name));
    return list;
  }, [compareMachines, filteredMachines]);
  const machines = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const getRowId = useCallback((machine: MergedMachine) => mergedKey(machine, machine.Name), []);
  const visibleIds = useMemo(() => machines.map(getRowId), [machines, getRowId]);
  const selection = useBulkSelection(ID, visibleIds);
  const { actions: bulkActions, getId: bulkGetId, refresh: bulkRefresh } = useMachineBulkActions();
  const { items, paddingTop, paddingBottom, measureRef, scrollElementRef, theadRef, isCollapsed, onGroupToggleClick } =
    useGroupedVirtualRows({ groups, getRowKey: (machine) => getRowId(machine), grouped, flatSort: compareMachines });
  const showEngineRowAccent = useShowEngineRowAccent();
  const onReload = useCallback(() => {
    for (const query of machineQueries) {
      query.refetch();
    }
  }, [machineQueries]);

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
                  items={machines}
                  getId={bulkGetId}
                  selectedIds={selection.selectedIds}
                  actions={bulkActions}
                  onClear={selection.clear}
                  refresh={bulkRefresh}
                />
                <Divider />
              </>
            ) : null}
            <ActionsMenu connectionId={machineConnections[0]?.id ?? currentConnector?.id ?? ""} onReload={onReload} />
          </>
        }
      />
      <div className="AppScreenContent" ref={scrollElementRef}>
        {groups.length === 0 ? (
          <NonIdealState
            icon={IconNames.GEOSEARCH}
            title={t("No results")}
            description={<p>{t("There are no machines")}</p>}
          />
        ) : (
          <HTMLTable
            interactive
            compact
            className="AppDataTable GroupedTable"
            data-windowed="true"
            data-table="machines"
            data-grouped={grouped ? "true" : "false"}
          >
            <thead ref={theadRef}>
              <tr>
                <SortableColumnHeader field="name" direction={getColumnSortDirection("name")} onSort={toggleColumnSort}>
                  <AppLabel iconName={IconNames.HEAT_GRID} text={t("Name")} />
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="vmType"
                  direction={getColumnSortDirection("vmType")}
                  onSort={toggleColumnSort}
                >
                  {t("VM Type")}
                </SortableColumnHeader>
                <SortableColumnHeader field="cpus" direction={getColumnSortDirection("cpus")} onSort={toggleColumnSort}>
                  {t("CPUs")}
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="memory"
                  direction={getColumnSortDirection("memory")}
                  onSort={toggleColumnSort}
                >
                  {t("Memory")}
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="diskSize"
                  direction={getColumnSortDirection("diskSize")}
                  onSort={toggleColumnSort}
                >
                  {t("Disk Size")}
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="default"
                  direction={getColumnSortDirection("default")}
                  onSort={toggleColumnSort}
                >
                  {t("Default")}
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="running"
                  direction={getColumnSortDirection("running")}
                  onSort={toggleColumnSort}
                >
                  {t("Running")}
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="lastUp"
                  direction={getColumnSortDirection("lastUp")}
                  onSort={toggleColumnSort}
                >
                  <AppLabel iconName={IconNames.CALENDAR} text={t("Last Up")} />
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
                  const group = descriptor.group as MachineConnectionGroup;
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
                          title={t("{{name}} machines", { name: group.connection.name })}
                          text={
                            <>
                              <EngineCell engine={group.connection.engine} connectionName={group.connection.name} />
                              <span className="buttonTextLabel">{group.connection.name}</span>
                              <span className="GroupedTableGroupMeta">{engineLabel(group.connection.engine)}</span>
                              <span className="GroupedTableGroupSum">
                                {group.items.length} {group.items.length === 1 ? t("machine") : t("machines")}
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
                const machine = descriptor.item;
                const rowId = key;
                const linkLocation = descriptor.isFirst ? "first" : descriptor.isLast ? "last" : undefined;
                return (
                  <tr
                    key={key}
                    ref={measureRef}
                    data-index={index}
                    data-prefix-group={machine.connectionId}
                    data-striped={striped}
                    data-engine-row={showEngineRowAccent ? machine.engine : undefined}
                  >
                    <td>
                      <div className="AppDataTableGroupLink" data-link-location={linkLocation}>
                        <div className="AppDataTableGroupLinkVertical" />
                        <div className="AppDataTableGroupLinkHorizontal" />
                      </div>
                      <AppDataTableLink
                        className="InspectMachineButton"
                        fillCell
                        href={getMachineUrl(machine.Name, "inspect", machine.connectionId)}
                        iconName={IconNames.EYE_OPEN}
                        text={machine.Name}
                      />
                    </td>
                    <td>{machine.VMType}</td>
                    <td>{machine.CPUs || "-"}</td>
                    <td>
                      {machine.Memory && !Number.isNaN(Number(machine.Memory))
                        ? prettyBytes(Number(machine.Memory))
                        : "-"}
                    </td>
                    <td>
                      {machine.DiskSize && !Number.isNaN(Number(machine.DiskSize))
                        ? prettyBytes(Number(machine.DiskSize))
                        : "-"}
                    </td>
                    <td>{machine.Default ? t("Yes") : t("No")}</td>
                    <td>{machine.Running ? t("Yes") : t("No")}</td>
                    <td>{dayjs(machine.LastUp).format("DD MMM YYYY HH:mm")}</td>
                    <td>{dayjs(machine.Created).format("DD MMM YYYY HH:mm")}</td>
                    <td data-column="Actions">
                      <ActionsMenu withoutCreate machine={machine} connectionId={machine.connectionId} />
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
Screen.Title = i18n.t("Machines");
Screen.Route = {
  Path: `/screens/${ID}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.HEAT_GRID,
};
Screen.isAvailable = (currentConnector?: Connector) => {
  return currentConnector?.capabilities?.extensions.machines === true;
};
