import { Button, Code, Divider, HTMLTable, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import dayjs from "dayjs";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { Connector, Pod } from "@/env/Types";
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
  useMergedResources,
  useResourcesReload,
  useShowEngineRowAccent,
} from "@/web-app/hooks/useMergedResources";
import { pathTo } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { compareSortValues, type SortSelectors } from "@/web-app/utils/comparators";

import { ItemActionsMenu, ListActionsMenu } from ".";
import { usePodBulkActions } from "./bulkActions";
import "./ManageScreen.css";

export interface ScreenProps extends AppScreenProps {}

export const ID = "pods";

// Always-merged: rows from every connected engine (pods are Podman-only), each carrying its engine/connection.
type MergedPod = MergedResource<Pod>;
interface PodConnectionGroup extends ConnectionGroup<MergedPod> {
  connection: {
    id: string;
    name: string;
    engine: string;
  };
}

const COLUMN_COUNT = 7;

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
  const showEngineRowAccent = useShowEngineRowAccent();
  const podSnapshot = useMergedResources("pods");
  const filteredPods = useMemo(
    () => (searchTerm ? podSnapshot.filter(createPodSearchFilter(searchTerm)) : podSnapshot),
    [podSnapshot, searchTerm],
  );
  const comparePods = useCallback(
    (a: MergedPod, b: MergedPod) => {
      if (clientSort) {
        const selector = podSortSelectors[clientSort.field];
        if (selector) {
          return (clientSort.dir === "asc" ? 1 : -1) * compareSortValues(selector(a), selector(b));
        }
      }
      return sortAlphaNum(a.Name, b.Name);
    },
    [clientSort],
  );
  const groups = useMemo(() => {
    const byConnection = new Map<string, PodConnectionGroup>();
    for (const pod of filteredPods) {
      let group = byConnection.get(pod.connectionId);
      if (!group) {
        group = {
          key: pod.connectionId,
          connection: {
            id: pod.connectionId,
            name: pod.connectionName,
            engine: `${pod.engine}`,
          },
          items: [],
        };
        byConnection.set(pod.connectionId, group);
      }
      group.items.push(pod);
    }
    const list = [...byConnection.values()];
    for (const group of list) {
      group.items.sort(comparePods);
    }
    list.sort((a, b) => sortAlphaNum(a.connection.name, b.connection.name));
    return list;
  }, [comparePods, filteredPods]);
  const pods = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  // Composite selection/React key — ids collide across engines, so qualify each by its connection.
  const getRowId = useCallback((pod: MergedPod) => mergedKey(pod, pod.Id), []);
  const visibleIds = useMemo(() => pods.map(getRowId), [pods, getRowId]);
  const selection = useBulkSelection(ID, visibleIds);
  const { actions: bulkActions, refresh: bulkRefresh } = usePodBulkActions();
  const { items, paddingTop, paddingBottom, measureRef, scrollElementRef, theadRef, isCollapsed, onGroupToggleClick } =
    useGroupedVirtualRows({ groups, getRowKey: (pod) => getRowId(pod) });
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
      <div className="AppScreenContent" ref={scrollElementRef}>
        {groups.length === 0 ? (
          <NonIdealState
            icon={IconNames.GEOSEARCH}
            title={t("No results")}
            description={<p>{t("There are no pods")}</p>}
          />
        ) : (
          <HTMLTable interactive compact className="AppDataTable GroupedTable" data-windowed="true" data-table="pods">
            <thead ref={theadRef}>
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
              </tr>
            </thead>
            <tbody>
              <VirtualSpacerRow height={paddingTop} columnCount={COLUMN_COUNT} />
              {items.map(({ row: descriptor, index, key }) => {
                const striped = index % 2 === 0 ? "true" : undefined;
                if (descriptor.kind === "group-header") {
                  const group = descriptor.group as PodConnectionGroup;
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
                          title={t("{{name}} pods", { name: group.connection.name })}
                          text={
                            <>
                              <EngineCell engine={group.connection.engine} connectionName={group.connection.name} />
                              <span className="buttonTextLabel">{group.connection.name}</span>
                              <span className="GroupedTableGroupMeta">{engineLabel(group.connection.engine)}</span>
                              <span className="GroupedTableGroupSum">
                                {group.items.length} {group.items.length === 1 ? t("pod") : t("pods")}
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
                const pod = descriptor.item;
                const rowId = key;
                const linkLocation = descriptor.isFirst ? "first" : descriptor.isLast ? "last" : undefined;
                const podDetailsButton = (
                  <>
                    <div className="AppDataTableGroupLink" data-link-location={linkLocation}>
                      <div className="AppDataTableGroupLinkVertical" />
                      <div className="AppDataTableGroupLinkHorizontal" />
                    </div>
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
                  </>
                );
                const creationDate =
                  typeof pod.Created === "string" ? dayjs(pod.Created) : dayjs(Number(pod.Created) * 1000);
                return (
                  <tr
                    key={key}
                    ref={measureRef}
                    data-index={index}
                    data-prefix-group={pod.connectionId}
                    data-striped={striped}
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
Screen.Title = i18n.t("Pods");
Screen.Route = {
  Path: `/screens/${ID}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.CUBE_ADD,
};
Screen.isAvailable = (currentConnector?: Connector) => {
  return currentConnector?.capabilities?.resources.pods === true;
};
