import { AnchorButton, Code, Divider, HTMLTable, Icon, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiCubeUnfolded } from "@mdi/js";
import dayjs from "dayjs";
import prettyBytes from "pretty-bytes";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { ContainerImage } from "@/env/Types";
import { AppLabel } from "@/web-app/components/AppLabel";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { BulkActionsBar, SelectionCheckbox, useBulkSelection } from "@/web-app/components/Bulk";
import { SortableColumnHeader } from "@/web-app/components/SortableColumnHeader";
import { useColumnSort } from "@/web-app/hooks/useColumnSort";
import { useAppStore } from "@/web-app/stores/appStore";
import { resourceEvents } from "@/web-app/stores/resourceEvents";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { type SortSelectors, sortByField } from "@/web-app/utils/comparators";

import { ActionsMenu, getImageUrl } from ".";
import { useImageBulkActions } from "./bulkActions";
import "./ManageScreen.css";

export const ID = "images";

export interface ScreenProps extends AppScreenProps {}

const EMPTY_IMAGES: ContainerImage[] = [];

const createImageSearchFilter = (searchTerm: string) => {
  const query = searchTerm.toLowerCase();
  return (image: ContainerImage) => {
    const haystacks = [image.Name, image.Id].map((value) => value.toLowerCase());
    return haystacks.some((value) => value.includes(query));
  };
};

const imageSortSelectors: SortSelectors<ContainerImage> = {
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
  const connectionId = currentConnector?.id;
  const { clientSort, getColumnSortDirection, toggleColumnSort } = useColumnSort(
    ID,
    currentConnector?.capabilities?.sort,
  );
  const imageSnapshot = useResourceStore((state) =>
    connectionId ? state.byConnection[connectionId]?.images.items || EMPTY_IMAGES : EMPTY_IMAGES,
  );
  const images = useMemo(() => {
    const items = searchTerm ? imageSnapshot.filter(createImageSearchFilter(searchTerm)) : imageSnapshot;
    return sortByField(items, clientSort, imageSortSelectors);
  }, [clientSort, imageSnapshot, searchTerm]);
  const visibleIds = useMemo(() => images.map((i) => i.Id), [images]);
  const selection = useBulkSelection(ID, visibleIds);
  const { actions: bulkActions, getId: bulkGetId, refresh: bulkRefresh } = useImageBulkActions(connectionId || "");
  const onReload = useCallback(() => {
    if (connectionId) {
      resourceEvents.refresh(connectionId, "images");
    }
  }, [connectionId]);

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
                  getId={bulkGetId}
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
              </tr>
            </thead>
            <tbody>
              {images.map((image) => {
                const imageLayersButton = (
                  <AnchorButton
                    minimal
                    small
                    href={getImageUrl(image.Id, "layers")}
                    text={image.Name}
                    intent={Intent.PRIMARY}
                    icon={IconNames.LAYERS}
                  />
                );
                return (
                  <tr key={image.Id} data-image={image.Id}>
                    <td>{imageLayersButton}</td>
                    <td>{image.Registry}</td>
                    <td>{image.Tag}</td>
                    <td>
                      <Code>{image.Id.substring(0, 12)}</Code>
                    </td>
                    <td>{prettyBytes(image.Size)}</td>
                    <td>
                      <Code>{image.Containers}</Code>
                    </td>
                    <td>{(dayjs(image.Created * 1000) as any).format("DD MMM YYYY HH:mm")}</td>
                    <td>
                      <ActionsMenu image={image} />
                    </td>
                    <td className="BulkSelectColumn">
                      <SelectionCheckbox
                        checked={selection.isSelected(image.Id)}
                        onChange={() => selection.toggle(image.Id)}
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
Screen.Title = "Images";
Screen.Route = {
  Path: `/screens/${ID}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.BOX,
};
