import { AnchorButton, Divider, HTMLTable, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiScrewdriver } from "@mdi/js";
import dayjs from "dayjs";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { Volume } from "@/env/Types";
import { AppLabel } from "@/web-app/components/AppLabel";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { BulkActionsBar, SelectionCheckbox, useBulkSelection } from "@/web-app/components/Bulk";
import { SortableColumnHeader } from "@/web-app/components/SortableColumnHeader";
import { sortAlphaNum } from "@/web-app/domain/utils";
import { useColumnSort } from "@/web-app/hooks/useColumnSort";
import { useAppStore } from "@/web-app/stores/appStore";
import { resourceEvents } from "@/web-app/stores/resourceEvents";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { type SortSelectors, sortByField } from "@/web-app/utils/comparators";
import { VolumeActionsMenu } from ".";
import { useVolumeBulkActions } from "./bulkActions";
import { getVolumeUrl } from "./Navigation";
import "./ManageScreen.css";

export const ID = "volumes";

export interface ScreenProps extends AppScreenProps {}

const EMPTY_VOLUMES: Volume[] = [];

const createVolumeSearchFilter = (searchTerm: string) => {
  const query = searchTerm.toLowerCase();
  return (volume: Volume) => {
    const haystacks = [volume.Name, volume.Scope || ""].map((value) => value.toLowerCase());
    return haystacks.some((value) => value.includes(query));
  };
};

const volumeSortSelectors: SortSelectors<Volume> = {
  name: (volume) => volume.Name,
  driver: (volume) => volume.Driver,
  created: (volume) => Date.parse(volume.CreatedAt || ""),
};

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const currentConnector = useAppStore((state) => state.currentConnector);
  const connectionId = currentConnector?.id;
  const { clientSort, getColumnSortDirection, toggleColumnSort } = useColumnSort(
    ID,
    currentConnector?.capabilities?.sort,
  );
  const volumeSnapshot = useResourceStore((state) =>
    connectionId ? state.byConnection[connectionId]?.volumes.items || EMPTY_VOLUMES : EMPTY_VOLUMES,
  );
  const volumes = useMemo(() => {
    const items = searchTerm ? volumeSnapshot.filter(createVolumeSearchFilter(searchTerm)) : volumeSnapshot;
    return clientSort
      ? sortByField(items, clientSort, volumeSortSelectors)
      : [...items].sort((a, b) => sortAlphaNum(a.Name, b.Name));
  }, [clientSort, volumeSnapshot, searchTerm]);
  const visibleIds = useMemo(() => volumes.map((v) => v.Name), [volumes]);
  const selection = useBulkSelection(ID, visibleIds);
  const { actions: bulkActions, getId: bulkGetId, refresh: bulkRefresh } = useVolumeBulkActions(connectionId || "");
  const onReload = useCallback(() => {
    if (connectionId) {
      resourceEvents.refresh(connectionId, "volumes");
    }
  }, [connectionId]);

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
                  getId={bulkGetId}
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
              </tr>
            </thead>
            <tbody>
              {volumes.map((volume) => {
                return (
                  <tr key={volume.Name}>
                    <td>
                      <AnchorButton
                        className="PodDetailsButton"
                        minimal
                        small
                        href={getVolumeUrl(volume.Name, "inspect")}
                        text={volume.Name}
                        intent={Intent.PRIMARY}
                        icon={IconNames.EYE_OPEN}
                        title={volume.Mountpoint}
                      />
                    </td>
                    <td>{volume.Driver}</td>
                    <td>{(dayjs(volume.CreatedAt) as any).fromNow()}</td>
                    <td>
                      <VolumeActionsMenu withoutCreate volume={volume} />
                    </td>
                    <td className="BulkSelectColumn">
                      <SelectionCheckbox
                        checked={selection.isSelected(volume.Name)}
                        onChange={() => selection.toggle(volume.Name)}
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
Screen.Title = "Volumes";
Screen.Route = {
  Path: `/screens/${ID}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.DATABASE,
};
