import { Button, Code, Divider, HTMLTable, Icon, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiCubeUnfolded } from "@mdi/js";
import dayjs from "dayjs";
import prettyBytes from "pretty-bytes";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ContainerImage } from "@/env/Types";
import i18n from "@/i18n";
import { AppDataTableLink } from "@/web-app/components/AppDataTableLink";
import { AppLabel } from "@/web-app/components/AppLabel";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { BulkActionsBar, SelectionCheckbox, useBulkSelection } from "@/web-app/components/Bulk";
import { connectedConnections } from "@/web-app/components/ConnectionSelect";
import { EngineCell, engineLabel } from "@/web-app/components/EngineCell";
import type { ConnectionGroup } from "@/web-app/components/groupedTable/flattenConnectionGroups";
import { useGroupedVirtualRows } from "@/web-app/components/groupedTable/useGroupedVirtualRows";
import { ResourceListActions } from "@/web-app/components/ResourceListActions";
import { SortableColumnHeader } from "@/web-app/components/SortableColumnHeader";
import { VirtualSpacerRow } from "@/web-app/components/VirtualSpacerRow";
import { sortAlphaNum } from "@/web-app/domain/utils";
import { useColumnSort } from "@/web-app/hooks/useColumnSort";
import {
  type MergedResource,
  mergedKey,
  useGroupByConnection,
  useMergedResources,
  useResourceReload,
  useShowEngineRowAccent,
} from "@/web-app/hooks/useMergedResources";
import { getBuildUrl, isBuildSupported } from "@/web-app/screens/Build/Navigation";
import { SearchImagesDrawer } from "@/web-app/screens/Registry/SearchImagesDrawer";
import { useAppStore } from "@/web-app/stores/appStore";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { compareSortValues, type SortSelectors } from "@/web-app/utils/comparators";

import { ActionsMenu, getImageUrl, shortImageId } from ".";
import { useImageBulkActions } from "./bulkActions";
import "./ManageScreen.css";

export const ID = "images";

export interface ScreenProps extends AppScreenProps {}

// Always-merged workspace: rows come from every connected engine, each carrying its engine/connection.
type MergedImage = MergedResource<ContainerImage>;
interface ImageConnectionGroup extends ConnectionGroup<MergedImage> {
  connection: {
    id: string;
    name: string;
    engine: string;
  };
}

const COLUMN_COUNT = 9;

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
  const filteredImages = useMemo(
    () => (searchTerm ? imageSnapshot.filter(createImageSearchFilter(searchTerm)) : imageSnapshot),
    [imageSnapshot, searchTerm],
  );
  const compareImages = useCallback(
    (a: MergedImage, b: MergedImage) => {
      if (clientSort) {
        const selector = imageSortSelectors[clientSort.field];
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
    const byConnection = new Map<string, ImageConnectionGroup>();
    for (const image of filteredImages) {
      let group = byConnection.get(image.connectionId);
      if (!group) {
        group = {
          key: image.connectionId,
          connection: {
            id: image.connectionId,
            name: image.connectionName,
            engine: `${image.engine}`,
          },
          items: [],
        };
        byConnection.set(image.connectionId, group);
      }
      group.items.push(image);
    }
    const list = [...byConnection.values()];
    for (const group of list) {
      group.items.sort(compareImages);
    }
    list.sort((a, b) => sortAlphaNum(a.connection.name, b.connection.name));
    return list;
  }, [compareImages, filteredImages]);
  const images = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  // Composite selection/React key — ids collide across engines, so qualify each by its connection.
  const getRowId = useCallback((image: MergedImage) => mergedKey(image, image.Id), []);
  const visibleIds = useMemo(() => images.map(getRowId), [images, getRowId]);
  const selection = useBulkSelection(ID, visibleIds);
  const { actions: bulkActions, refresh: bulkRefresh } = useImageBulkActions();
  const showEngineRowAccent = useShowEngineRowAccent();
  const { items, paddingTop, paddingBottom, measureRef, scrollElementRef, theadRef, isCollapsed, onGroupToggleClick } =
    useGroupedVirtualRows({ groups, getRowKey: (image) => getRowId(image), grouped, flatSort: compareImages });
  // Always-merged: a manual reload refreshes this domain on every connected engine.
  const onReload = useResourceReload("images");

  // "Build image" CTA — the SOLE entry into the Build Studio (no sidebar item). We build images, not
  // containers, so the action lives here on the Images list. Gated on a native buildable connection.
  const connections = useAppStore((state) => state.connections);
  const activeRuntime = useResourceStore((state) => state.activeRuntime);
  const nativeBuildConnections = useMemo(
    () => connectedConnections(connections, activeRuntime, isBuildSupported),
    [connections, activeRuntime],
  );
  const buildSupported = nativeBuildConnections.length > 0;
  const buildConnId = nativeBuildConnections[0]?.id;

  // "Search images" CTA — searches REMOTE registries (Docker Hub, …) and pulls. It belongs on the Images list
  // (we search for images to pull), opening the shared registry-search drawer.
  const [searchDrawerOpen, setSearchDrawerOpen] = useState(false);

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
            <ResourceListActions
              actions={[
                {
                  className: "ImageSearchImagesButton",
                  icon: IconNames.SEARCH,
                  intent: Intent.NONE,
                  text: t("Search online"),
                  title: t("Search your configured registries (Docker Hub, …) for images to pull"),
                  onClick: () => setSearchDrawerOpen(true),
                },
                {
                  disabled: !buildSupported,
                  href: buildSupported ? getBuildUrl(buildConnId) : undefined,
                  icon: IconNames.BUILD,
                  text: t("Build image"),
                  title: buildSupported
                    ? t("Build an image from a Containerfile")
                    : t("Connect a native engine to build"),
                },
              ]}
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
            description={<p>{t("There are no images")}</p>}
          />
        ) : (
          <HTMLTable
            interactive
            compact
            className="AppDataTable GroupedTable"
            data-windowed="true"
            data-table="images"
            data-grouped={grouped ? "true" : "false"}
          >
            <thead ref={theadRef}>
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
              <VirtualSpacerRow height={paddingTop} columnCount={COLUMN_COUNT} />
              {items.map(({ row: descriptor, index, key }) => {
                const striped = index % 2 === 0 ? "true" : undefined;
                if (descriptor.kind === "group-header") {
                  const group = descriptor.group as ImageConnectionGroup;
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
                          title={t("{{name}} images", { name: group.connection.name })}
                          text={
                            <>
                              <EngineCell engine={group.connection.engine} connectionName={group.connection.name} />
                              <span className="buttonTextLabel">{group.connection.name}</span>
                              <span className="GroupedTableGroupMeta">{engineLabel(group.connection.engine)}</span>
                              <span className="GroupedTableGroupSum">
                                {group.items.length} {group.items.length === 1 ? t("image") : t("images")}
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
                const image = descriptor.item;
                const rowId = key;
                const linkLocation = descriptor.isFirst ? "first" : descriptor.isLast ? "last" : undefined;
                const imageLayersButton = (
                  <>
                    <div className="AppDataTableGroupLink" data-link-location={linkLocation}>
                      <div className="AppDataTableGroupLinkVertical" />
                      <div className="AppDataTableGroupLinkHorizontal" />
                    </div>
                    <AppDataTableLink
                      fillCell
                      href={getImageUrl(image.Id, "inspect", image.connectionId)}
                      text={image.Name || shortImageId(image.Id)}
                      muted={!image.Name}
                      iconName={IconNames.LAYERS}
                    />
                  </>
                );
                return (
                  <tr
                    key={key}
                    ref={measureRef}
                    data-index={index}
                    data-prefix-group={image.connectionId}
                    data-striped={striped}
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
                  </tr>
                );
              })}
              <VirtualSpacerRow height={paddingBottom} columnCount={COLUMN_COUNT} />
            </tbody>
          </HTMLTable>
        )}
      </div>
      {searchDrawerOpen ? <SearchImagesDrawer onClose={() => setSearchDrawerOpen(false)} /> : null}
    </div>
  );
};

Screen.ID = ID;
Screen.Title = i18n.t("Images");
Screen.Route = {
  Path: `/screens/${ID}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.BOX,
};
