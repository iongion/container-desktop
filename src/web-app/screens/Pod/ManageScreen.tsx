import { Code, Divider, HTMLTable, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import dayjs from "dayjs";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { Connector, Pod } from "@/env/Types";
import { AppDataTableLink } from "@/web-app/components/AppDataTableLink";
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
  useResourcesReload,
  useShowEngineColumn,
  useShowEngineRowAccent,
} from "@/web-app/hooks/useMergedResources";
import { useProgressiveTableRows } from "@/web-app/hooks/useProgressiveTableRows";
import { pathTo } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { type SortSelectors, sortByField } from "@/web-app/utils/comparators";

import { ItemActionsMenu, ListActionsMenu } from ".";
import { usePodBulkActions } from "./bulkActions";
import "./ManageScreen.css";

export interface ScreenProps extends AppScreenProps {}

export const ID = "pods";

// Always-merged: rows from every connected engine (pods are Podman-only), each carrying its engine/connection.
type MergedPod = MergedResource<Pod>;

const createPodSearchFilter = (searchTerm: string) => {
  const query = searchTerm.toLowerCase();
  return (pod: MergedPod) => {
    const haystacks = [pod.Name, pod.Id, pod.engine, pod.connectionName].map((value) => `${value ?? ""}`.toLowerCase());
    return haystacks.some((value) => value.includes(query));
  };
};

const podSortSelectors: SortSelectors<MergedPod> = {
  engine: (pod) => pod.engine,
  name: (pod) => pod.Name,
  containers: (pod) => pod.Containers.length,
  state: (pod) => pod.Status,
  id: (pod) => pod.Id,
  created: (pod) => (typeof pod.Created === "string" ? Date.parse(pod.Created) : Number(pod.Created) * 1000),
};

export const Screen: AppScreen<ScreenProps> = () => {
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { t } = useTranslation();
  const currentConnector = useAppStore((state) => state.currentConnector);
  const { clientSort, getColumnSortDirection, toggleColumnSort } = useColumnSort(
    ID,
    currentConnector?.capabilities?.sort,
  );
  const showEngineColumn = useShowEngineColumn();
  const showEngineRowAccent = useShowEngineRowAccent();
  const podSnapshot = useMergedResources("pods");
  const pods = useMemo(() => {
    const items = searchTerm ? podSnapshot.filter(createPodSearchFilter(searchTerm)) : podSnapshot;
    return clientSort
      ? sortByField(items, clientSort, podSortSelectors)
      : [...items].sort((a, b) => sortAlphaNum(a.Name, b.Name));
  }, [clientSort, podSnapshot, searchTerm]);
  const renderedPods = useProgressiveTableRows(pods);
  // Composite selection/React key — ids collide across engines, so qualify each by its connection.
  const getRowId = useCallback((pod: MergedPod) => mergedKey(pod, pod.Id), []);
  const visibleIds = useMemo(() => pods.map(getRowId), [pods, getRowId]);
  const selection = useBulkSelection(ID, visibleIds);
  const { actions: bulkActions, refresh: bulkRefresh } = usePodBulkActions();
  const onReload = useResourcesReload("pods", "containers");

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
                  items={pods}
                  getId={getRowId}
                  selectedIds={selection.selectedIds}
                  actions={bulkActions}
                  onClear={selection.clear}
                  refresh={bulkRefresh}
                />
                <Divider />
              </>
            ) : null}
            <ListActionsMenu onReload={onReload} />
          </>
        }
      />
      <div className="AppScreenContent">
        {pods.length === 0 ? (
          <NonIdealState
            icon={IconNames.GEOSEARCH}
            title={t("No results")}
            description={<p>{t("There are no pods")}</p>}
          />
        ) : (
          <HTMLTable interactive compact striped className="AppDataTable" data-table="pods">
            <thead>
              <tr>
                <SortableColumnHeader field="name" direction={getColumnSortDirection("name")} onSort={toggleColumnSort}>
                  <AppLabel iconName={IconNames.CUBE} text={t("Name")} />
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="containers"
                  direction={getColumnSortDirection("containers")}
                  onSort={toggleColumnSort}
                  title={t("Count of containers using the pod")}
                >
                  <AppLabel iconName={IconNames.BOX} />
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="state"
                  direction={getColumnSortDirection("state")}
                  onSort={toggleColumnSort}
                >
                  {t("State")}
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
              {renderedPods.map((pod) => {
                const rowId = getRowId(pod);
                const podDetailsButton = (
                  <AppDataTableLink
                    className="PodDetailsButton"
                    fillCell
                    href={pathTo(`/screens/pod/${encodeURIComponent(pod.Id)}/processes`, undefined, {
                      connId: pod.connectionId,
                    })}
                    text={pod.Name}
                    iconName={IconNames.LIST_COLUMNS}
                    title={t("Pod processes")}
                  />
                );
                const creationDate =
                  typeof pod.Created === "string" ? dayjs(pod.Created) : dayjs(Number(pod.Created) * 1000);
                return (
                  <tr
                    key={rowId}
                    data-pod={pod.Id}
                    data-engine-row={showEngineRowAccent ? pod.engine : undefined}
                    data-state={pod.Status}
                  >
                    <td>{podDetailsButton}</td>
                    <td>{pod.Containers.length}</td>
                    <td>
                      <span className="PodState" data-state={pod.Status}>
                        {pod.Status}
                      </span>
                    </td>
                    <td>
                      <Code>{pod.Id.substring(0, 12)}</Code>
                    </td>
                    <td>{creationDate.format("DD MMM YYYY HH:mm")}</td>
                    <td data-column="Actions">
                      <ItemActionsMenu pod={pod} connectionId={pod.connectionId} />
                    </td>
                    <td className="BulkSelectColumn">
                      <SelectionCheckbox
                        checked={selection.isSelected(rowId)}
                        onChange={() => selection.toggle(rowId)}
                      />
                    </td>
                    <EngineColumnCell
                      visible={showEngineColumn}
                      engine={pod.engine}
                      connectionName={pod.connectionName}
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
Screen.Title = "Pods";
Screen.Route = {
  Path: `/screens/${ID}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.CUBE_ADD,
};
Screen.isAvailable = (currentConnector?: Connector) => {
  return currentConnector?.capabilities?.resources.pods === true;
};
