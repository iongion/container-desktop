import { Divider, HTMLTable, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiScrewdriver } from "@mdi/js";
import dayjs from "dayjs";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { Volume } from "@/env/Types";
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
  useResourceReload,
  useShowEngineColumn,
  useShowEngineRowAccent,
} from "@/web-app/hooks/useMergedResources";
import { useProgressiveTableRows } from "@/web-app/hooks/useProgressiveTableRows";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { type SortSelectors, sortByField } from "@/web-app/utils/comparators";
import { VolumeActionsMenu } from ".";
import { useVolumeBulkActions } from "./bulkActions";
import { getVolumeUrl } from "./Navigation";
import "./ManageScreen.css";

export const ID = "volumes";

export interface ScreenProps extends AppScreenProps {}

// Always-merged workspace: rows come from every connected engine, each carrying its engine/connection.
type MergedVolume = MergedResource<Volume>;

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
  const volumes = useMemo(() => {
    const items = searchTerm ? volumeSnapshot.filter(createVolumeSearchFilter(searchTerm)) : volumeSnapshot;
    return clientSort
      ? sortByField(items, clientSort, volumeSortSelectors)
      : [...items].sort((a, b) => sortAlphaNum(a.Name, b.Name));
  }, [clientSort, volumeSnapshot, searchTerm]);
  const renderedVolumes = useProgressiveTableRows(volumes);
  // Composite selection/React key — ids collide across engines, so qualify each by its connection.
  const getRowId = useCallback((volume: MergedVolume) => mergedKey(volume, volume.Name), []);
  const visibleIds = useMemo(() => volumes.map(getRowId), [volumes, getRowId]);
  const selection = useBulkSelection(ID, visibleIds);
  const { actions: bulkActions, refresh: bulkRefresh } = useVolumeBulkActions();
  const showEngineColumn = useShowEngineColumn();
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
                  items={volumes}
                  getId={getRowId}
                  selectedIds={selection.selectedIds}
                  actions={bulkActions}
                  onClear={selection.clear}
                  refresh={bulkRefresh}
                />
                <Divider />
              </>
            ) : null}
            <VolumeActionsMenu onReload={onReload} />
          </>
        }
      />
      <div className="AppScreenContent">
        {volumes.length === 0 ? (
          <NonIdealState
            icon={IconNames.GEOSEARCH}
            title={t("No results")}
            description={<p>{t("There are no volumes")}</p>}
          />
        ) : (
          <HTMLTable interactive compact striped className="AppDataTable" data-table="volumes">
            <thead>
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
                <EngineColumnHeader visible={showEngineColumn} />
              </tr>
            </thead>
            <tbody>
              {renderedVolumes.map((volume) => {
                const rowId = getRowId(volume);
                return (
                  <tr key={rowId} data-engine-row={showEngineRowAccent ? volume.engine : undefined}>
                    <td>
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
                    <EngineColumnCell
                      visible={showEngineColumn}
                      engine={volume.engine}
                      connectionName={volume.connectionName}
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
Screen.Title = "Volumes";
Screen.Route = {
  Path: `/screens/${ID}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.DATABASE,
};
