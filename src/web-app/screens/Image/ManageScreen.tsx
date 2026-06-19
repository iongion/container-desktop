import { Code, Divider, HTMLTable, Icon, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiCubeUnfolded } from "@mdi/js";
import dayjs from "dayjs";
import prettyBytes from "pretty-bytes";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { ContainerImage } from "@/env/Types";
import { AppDataTableLink } from "@/web-app/components/AppDataTableLink";
import { AppLabel } from "@/web-app/components/AppLabel";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { BulkActionsBar, SelectionCheckbox, useBulkSelection } from "@/web-app/components/Bulk";
import { EngineColumnCell, EngineColumnHeader } from "@/web-app/components/EngineCell";
import { SortableColumnHeader } from "@/web-app/components/SortableColumnHeader";
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

import { ActionsMenu, getImageUrl } from ".";
import { useImageBulkActions } from "./bulkActions";
import "./ManageScreen.css";

export const ID = "images";

export interface ScreenProps extends AppScreenProps {}

// Always-merged workspace: rows come from every connected engine, each carrying its engine/connection.
type MergedImage = MergedResource<ContainerImage>;

const createImageSearchFilter = (searchTerm: string) => {
  const query = searchTerm.toLowerCase();
  return (image: MergedImage) => {
    const haystacks = [image.Name, image.Id, image.engine, image.connectionName].map((value) =>
      `${value ?? ""}`.toLowerCase(),
    );
    return haystacks.some((value) => value.includes(query));
  };
};

const imageSortSelectors: SortSelectors<MergedImage> = {
  engine: (image) => image.engine,
  name: (image) => image.Name,
  registry: (image) => image.Registry,
  tag: (image) => image.Tag,
  id: (image) => image.Id,
  size: (image) => image.Size,
  containers: (image) => image.Containers,
  created: (image) => image.Created,
};

export const Screen: AppScreen<ScreenProps> = () => {
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { t } = useTranslation();
  const currentConnector = useAppStore((state) => state.currentConnector);
  const { clientSort, getColumnSortDirection, toggleColumnSort } = useColumnSort(
    ID,
    currentConnector?.capabilities?.sort,
  );
  const imageSnapshot = useMergedResources("images");
  const images = useMemo(() => {
    const items = searchTerm ? imageSnapshot.filter(createImageSearchFilter(searchTerm)) : imageSnapshot;
    return sortByField(items, clientSort, imageSortSelectors);
  }, [clientSort, imageSnapshot, searchTerm]);
  const renderedImages = useProgressiveTableRows(images);
  // Composite selection/React key — ids collide across engines, so qualify each by its connection.
  const getRowId = useCallback((image: MergedImage) => mergedKey(image, image.Id), []);
  const visibleIds = useMemo(() => images.map(getRowId), [images, getRowId]);
  const selection = useBulkSelection(ID, visibleIds);
  const { actions: bulkActions, refresh: bulkRefresh } = useImageBulkActions();
  const showEngineColumn = useShowEngineColumn();
  const showEngineRowAccent = useShowEngineRowAccent();
  // Always-merged: a manual reload refreshes this domain on every connected engine.
  const onReload = useResourceReload("images");

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader
        searchTerm={searchTerm}
        onSearch={onSearchChange}
        rightContent={
          <>
            {selection.count > 0 ? (
              <>
                <BulkActionsBar
                  items={images}
                  getId={getRowId}
                  selectedIds={selection.selectedIds}
                  actions={bulkActions}
                  onClear={selection.clear}
                  refresh={bulkRefresh}
                />
                <Divider />
              </>
            ) : null}
            <ActionsMenu withoutStart onReload={onReload} />
          </>
        }
      />
      <div className="AppScreenContent">
        {images.length === 0 ? (
          <NonIdealState
            icon={IconNames.GEOSEARCH}
            title={t("No results")}
            description={<p>{t("There are no images")}</p>}
          />
        ) : (
          <HTMLTable interactive striped compact className="AppDataTable" data-table="images">
            <thead>
              <tr>
                <SortableColumnHeader field="name" direction={getColumnSortDirection("name")} onSort={toggleColumnSort}>
                  <AppLabel iconName={IconNames.BOX} text={t("Name")} />
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="registry"
                  direction={getColumnSortDirection("registry")}
                  onSort={toggleColumnSort}
                >
                  <AppLabel iconPath={mdiCubeUnfolded} text={t("Registry")} />
                </SortableColumnHeader>
                <SortableColumnHeader field="tag" direction={getColumnSortDirection("tag")} onSort={toggleColumnSort}>
                  <AppLabel iconName={IconNames.TAG} text={t("Tag")} />
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="id"
                  direction={getColumnSortDirection("id")}
                  onSort={toggleColumnSort}
                  title={t("First 12 characters")}
                >
                  <AppLabel iconName={IconNames.BARCODE} text={t("Id")} />
                </SortableColumnHeader>
                <SortableColumnHeader field="size" direction={getColumnSortDirection("size")} onSort={toggleColumnSort}>
                  {t("Size")}
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="containers"
                  direction={getColumnSortDirection("containers")}
                  onSort={toggleColumnSort}
                  title={t("Count of containers using the image")}
                >
                  <Icon icon={IconNames.CUBE} />
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
              {renderedImages.map((image) => {
                const rowId = getRowId(image);
                const imageLayersButton = (
                  <AppDataTableLink
                    fillCell
                    href={getImageUrl(image.Id, "layers", image.connectionId)}
                    text={image.Name}
                    iconName={IconNames.LAYERS}
                  />
                );
                return (
                  <tr
                    key={rowId}
                    data-image={image.Id}
                    data-image-key={rowId}
                    data-engine-row={showEngineRowAccent ? image.engine : undefined}
                  >
                    <td>{imageLayersButton}</td>
                    <td>{image.Registry}</td>
                    <td data-column="tag">
                      <span className="ContainerImageTag" title={image.Tag}>
                        {image.Tag}
                      </span>
                    </td>
                    <td>
                      <Code>{image.Id.substring(0, 12)}</Code>
                    </td>
                    <td>{prettyBytes(image.Size)}</td>
                    <td>
                      <Code>{image.Containers}</Code>
                    </td>
                    <td>{(dayjs(image.Created * 1000) as any).format("DD MMM YYYY HH:mm")}</td>
                    <td data-column="Actions">
                      <ActionsMenu image={image} connectionId={image.connectionId} iconOnly />
                    </td>
                    <td className="BulkSelectColumn">
                      <SelectionCheckbox
                        checked={selection.isSelected(rowId)}
                        onChange={() => selection.toggle(rowId)}
                      />
                    </td>
                    <EngineColumnCell
                      visible={showEngineColumn}
                      engine={image.engine}
                      connectionName={image.connectionName}
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
Screen.Title = "Images";
Screen.Route = {
  Path: `/screens/${ID}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.BOX,
};
