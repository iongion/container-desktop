import { AnchorButton, Divider, HTMLTable, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import dayjs from "dayjs";
import prettyBytes from "pretty-bytes";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { Connector, PodmanMachine } from "@/env/Types";
import { AppLabel } from "@/web-app/components/AppLabel";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { BulkActionsBar, SelectionCheckbox, useBulkSelection } from "@/web-app/components/Bulk";
import { SortableColumnHeader } from "@/web-app/components/SortableColumnHeader";
import { useColumnSort } from "@/web-app/hooks/useColumnSort";
import { useAppStore } from "@/web-app/stores/appStore";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { type SortSelectors, sortByField } from "@/web-app/utils/comparators";

import { ActionsMenu } from ".";
import { useMachineBulkActions } from "./bulkActions";
import "./ManageScreen.css";
import { getMachineUrl } from "./Navigation";
import { useMachinesList } from "./queries";

export const ID = "machines";

export interface ScreenProps extends AppScreenProps {}

const EMPTY_MACHINES: PodmanMachine[] = [];

const createMachineSearchFilter = (searchTerm: string) => {
  const query = searchTerm.toLowerCase();
  return (machine: PodmanMachine) => {
    const haystacks = [machine.Name, machine.VMType].map((value) => value.toLowerCase());
    return haystacks.some((value) => value.includes(query));
  };
};

const machineSortSelectors: SortSelectors<PodmanMachine> = {
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
  const activeRuntime = useResourceStore((state) => state.activeRuntime);
  const machineRuntime = useMemo(
    () =>
      currentConnector?.capabilities?.extensions.machines
        ? { id: currentConnector.id, capabilities: currentConnector.capabilities }
        : activeRuntime.find((info) => info.running && info.capabilities?.extensions?.machines === true),
    [activeRuntime, currentConnector],
  );
  const connectionId = machineRuntime?.id || "";
  const { clientSort, getColumnSortDirection, toggleColumnSort } = useColumnSort(ID, machineRuntime?.capabilities?.sort);
  const machinesQuery = useMachinesList(connectionId, machineRuntime?.capabilities?.extensions.machines === true);
  const machineSnapshot = machinesQuery.data || EMPTY_MACHINES;
  const machines = useMemo(() => {
    const items = searchTerm ? machineSnapshot.filter(createMachineSearchFilter(searchTerm)) : machineSnapshot;
    return sortByField(items, clientSort, machineSortSelectors);
  }, [clientSort, machineSnapshot, searchTerm]);
  const visibleIds = useMemo(() => machines.map((m) => m.Name), [machines]);
  const selection = useBulkSelection(ID, visibleIds);
  const { actions: bulkActions, getId: bulkGetId, refresh: bulkRefresh } = useMachineBulkActions(connectionId || "");
  const onReload = useCallback(() => {
    machinesQuery.refetch();
  }, [machinesQuery]);

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
            <ActionsMenu connectionId={connectionId} onReload={onReload} />
          </>
        }
      />
      <div className="AppScreenContent">
        {machines.length === 0 ? (
          <NonIdealState
            icon={IconNames.GEOSEARCH}
            title={t("No results")}
            description={<p>{t("There are no machines")}</p>}
          />
        ) : (
          <HTMLTable interactive compact striped className="AppDataTable" data-table="machines">
            <thead>
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
              {machines.map((machine) => {
                return (
                  <tr key={machine.Name}>
                    <td>
                      <AnchorButton
                        className="InspectMachineButton"
                        variant="minimal"
                        size="small"
                        href={getMachineUrl(machine.Name, "inspect", connectionId)}
                        intent={Intent.PRIMARY}
                        icon={IconNames.EYE_OPEN}
                      >
                        <span>{machine.Name}</span>
                      </AnchorButton>
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
                    <td>
                      <ActionsMenu withoutCreate machine={machine} connectionId={connectionId} />
                    </td>
                    <td className="BulkSelectColumn">
                      <SelectionCheckbox
                        checked={selection.isSelected(machine.Name)}
                        onChange={() => selection.toggle(machine.Name)}
                      />
                    </td>
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
Screen.Title = "Machines";
Screen.Route = {
  Path: `/screens/${ID}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.HEAT_GRID,
};
Screen.isAvailable = (currentConnector?: Connector) => {
  return currentConnector?.capabilities?.extensions.machines === true;
};
