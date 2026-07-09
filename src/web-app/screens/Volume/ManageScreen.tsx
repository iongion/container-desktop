import { Button, Divider, HTMLTable, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiScrewdriver } from "@mdi/js";
import dayjs from "dayjs";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { AppDataTableLink } from "@/web-app/components/AppDataTableLink";
import { AppLabel } from "@/web-app/components/AppLabel";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { BulkActionsBar, SelectionCheckbox, useBulkSelection } from "@/web-app/components/Bulk";
import { EngineCell, engineLabel } from "@/web-app/components/EngineCell";
import { useGroupedVirtualRows } from "@/web-app/components/groupedTable/useGroupedVirtualRows";
import { SortableColumnHeader } from "@/web-app/components/SortableColumnHeader";
import { VirtualSpacerRow } from "@/web-app/components/VirtualSpacerRow";
import { sortAlphaNum } from "@/web-app/domain/utils";
import { useColumnSort } from "@/web-app/hooks/useColumnSort";
import {
  mergedKey,
  useGroupByConnection,
  useMergedResources,
  useResourceReload,
  useShowEngineRowAccent,
} from "@/web-app/hooks/useMergedResources";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { compareSortValues, type SortSelectors } from "@/web-app/utils/comparators";

import { VolumeActionsMenu } from ".";
import { useVolumeBulkActions } from "./bulkActions";
import { getVolumeUrl } from "./Navigation";
import { ScreenHeaderSectionsTabBar } from "./ScreenHeader";
import { groupVolumesByConnection, type MergedVolume, type VolumeConnectionGroup } from "./volumeGroups";
import "./ManageScreen.css";

export const ID = "volumes";

export interface ScreenProps extends AppScreenProps {}

const COLUMN_COUNT = 5;

const createVolumeSearchFilter = (searchTerm: string) => {
  const query = searchTerm.toLowerCase();
  return (volume: MergedVolume) => {
    const haystacks = [volume.Name, volume.Scope, volume.engine, volume.connectionName].map((value) =>
      `${value ?? ""}`.toLowerCase(),
    );
    return haystacks.some((value) => value.includes(query));
  };
};

const volumeSortSelectors: SortSelectors<MergedVolume> = {
  engine: (volume) => volume.engine,
  name: (volume) => volume.Name,
  driver: (volume) => volume.Driver,
  created: (volume) => Date.parse(volume.CreatedAt || ""),
};

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const currentConnector = useAppStore((state) => state.currentConnector);
  const { clientSort, getColumnSortDirection, toggleColumnSort } = useColumnSort(
    ID,
    currentConnector?.capabilities?.sort,
  );
  const volumeSnapshot = useMergedResources("volumes");
  const filteredVolumes = useMemo(
    () => (searchTerm ? volumeSnapshot.filter(createVolumeSearchFilter(searchTerm)) : volumeSnapshot),
    [volumeSnapshot, searchTerm],
  );
  const compareVolumes = useCallback(
    (a: MergedVolume, b: MergedVolume) => {
      if (clientSort) {
        const selector = volumeSortSelectors[clientSort.field];
        if (selector) {
          return (clientSort.dir === "asc" ? 1 : -1) * compareSortValues(selector(a), selector(b));
        }
      }
      return sortAlphaNum(a.Name, b.Name);
    },
    [clientSort],
  );
  const grouped = useGroupByConnection();
  const groups = useMemo(
    () => groupVolumesByConnection(filteredVolumes, compareVolumes),
    [compareVolumes, filteredVolumes],
  );
  const visibleItems = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  // Composite selection/React key — ids collide across engines, so qualify each by its connection.
  const getRowId = useCallback((volume: MergedVolume) => mergedKey(volume, volume.Name), []);
  const visibleIds = useMemo(() => visibleItems.map(getRowId), [visibleItems, getRowId]);
  const selection = useBulkSelection(ID, visibleIds);
  const { actions: bulkActions, refresh: bulkRefresh } = useVolumeBulkActions();
  const { items, paddingTop, paddingBottom, measureRef, scrollElementRef, theadRef, isCollapsed, onGroupToggleClick } =
    useGroupedVirtualRows({ groups, getRowKey: (volume) => getRowId(volume), grouped, flatSort: compareVolumes });
  const showEngineRowAccent = useShowEngineRowAccent();
  // Always-merged: a manual reload refreshes this domain on every connected engine.
  const onReload = useResourceReload("volumes");

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader
        searchTerm={searchTerm}
        onSearch={onSearchChange}
        titleIcon={IconNames.DATABASE}
        rightContent={
          <>
            {selection.count > 0 ? (
              <>
                <BulkActionsBar
                  items={visibleItems}
                  getId={getRowId}
                  selectedIds={selection.selectedIds}
                  actions={bulkActions}
                  onClear={selection.clear}
                  refresh={bulkRefresh}
                />
                <Divider />
              </>
            ) : null}
            <VolumeActionsMenu
              navigation={<ScreenHeaderSectionsTabBar isActive={(screen) => screen === "volumes.manage"} />}
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
            description={<p>{t("There are no volumes")}</p>}
          />
        ) : (
          <HTMLTable
            interactive
            compact
            className="AppDataTable GroupedTable VolumesTable"
            data-windowed="true"
            data-table="volumes"
            data-grouped={grouped ? "true" : "false"}
          >
            <thead ref={theadRef}>
              <tr>
                <SortableColumnHeader field="name" direction={getColumnSortDirection("name")} onSort={toggleColumnSort}>
                  <AppLabel iconName={IconNames.DATABASE} text={t("Name")} />
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="driver"
                  direction={getColumnSortDirection("driver")}
                  onSort={toggleColumnSort}
                >
                  <AppLabel iconPath={mdiScrewdriver} text={t("Driver")} />
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
                  const group = descriptor.group as VolumeConnectionGroup;
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
                          title={t("{{name}} volumes", { name: group.connection.name })}
                          text={
                            <>
                              <EngineCell engine={group.connection.engine} connectionName={group.connection.name} />
                              <span className="buttonTextLabel">{group.connection.name}</span>
                              <span className="GroupedTableGroupMeta">{engineLabel(group.connection.engine)}</span>
                              <span className="GroupedTableGroupSum">
                                {group.items.length} {group.items.length === 1 ? t("volume") : t("volumes")}
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
                const volume = descriptor.item;
                const rowId = key;
                const linkLocation = descriptor.isFirst ? "first" : descriptor.isLast ? "last" : undefined;
                return (
                  <tr
                    key={key}
                    ref={measureRef}
                    data-index={index}
                    data-prefix-group={volume.connectionId}
                    data-striped={striped}
                    data-engine-row={showEngineRowAccent ? volume.engine : undefined}
                  >
                    <td>
                      <div className="AppDataTableGroupLink" data-link-location={linkLocation}>
                        <div className="AppDataTableGroupLinkVertical" />
                        <div className="AppDataTableGroupLinkHorizontal" />
                      </div>
                      <AppDataTableLink
                        className="PodDetailsButton"
                        fillCell
                        href={getVolumeUrl(volume.Name, "inspect", volume.connectionId)}
                        text={volume.Name}
                        iconName={IconNames.EYE_OPEN}
                        title={volume.Mountpoint}
                      />
                    </td>
                    <td>{volume.Driver}</td>
                    <td>{(dayjs(volume.CreatedAt) as any).fromNow()}</td>
                    <td data-column="Actions">
                      <VolumeActionsMenu withoutCreate volume={volume} connectionId={volume.connectionId} />
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
Screen.Title = i18n.t("Volumes");
Screen.Route = {
  Path: `/screens/${ID}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.DATABASE,
  Tooltip: i18n.t("Volumes and mounts"),
};
