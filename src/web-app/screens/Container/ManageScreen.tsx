import { Button, ButtonGroup, Code, Divider, HTMLTable, Icon, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import dayjs from "dayjs";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { type Container, ContainerStateList } from "@/env/Types";
import { AppDataTableLink } from "@/web-app/components/AppDataTableLink";
import { AppLabel } from "@/web-app/components/AppLabel";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { BulkActionsBar, SelectionCheckbox, useBulkSelection } from "@/web-app/components/Bulk";
import { EngineColumnCell, EngineColumnHeader } from "@/web-app/components/EngineCell";
import { SortableColumnHeader } from "@/web-app/components/SortableColumnHeader";
import { VirtualSpacerRow } from "@/web-app/components/VirtualSpacerRow";
import { useColumnSort } from "@/web-app/hooks/useColumnSort";
import {
  type MergedResource,
  mergedKey,
  useMergedResources,
  useResourceReload,
  useShowEngineColumn,
  useShowEngineRowAccent,
} from "@/web-app/hooks/useMergedResources";
import { useTableScroll, useWindowedRows } from "@/web-app/hooks/useWindowedRows";
import { pathTo } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { ActionsMenu } from ".";
import { useContainerBulkActions } from "./bulkActions";
import { type ContainerRowDescriptor, flattenGroups } from "./flattenGroups";
import { groupContainers } from "./grouping";
import "./ManageScreen.css";

export interface ScreenProps extends AppScreenProps {}

export const ID = "containers";

// Always-merged: rows from every connected engine, each carrying its engine/connection.
type MergedContainer = MergedResource<Container>;

// Stable (module-level) virtualizer callbacks — avoids re-creating them per render.
const getDescriptorKey = (descriptor: ContainerRowDescriptor): string => descriptor.key;
const estimateContainerRowHeight = (descriptor: ContainerRowDescriptor): number =>
  descriptor.kind === "group-header" ? 34 : 28;

export const Screen: AppScreen<ScreenProps> = () => {
  const [containerOverlay, setContainerOverlay] = useState<string | undefined>();
  const [collapse, setCollapse] = useState<{
    [key: string]: boolean | undefined;
  }>({});
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { t } = useTranslation();
  const currentConnector = useAppStore((state) => state.currentConnector);
  const { clientSort, getColumnSortDirection, toggleColumnSort } = useColumnSort(
    ID,
    currentConnector?.capabilities?.sort,
  );
  const showEngineColumn = useShowEngineColumn();
  const showEngineRowAccent = useShowEngineRowAccent();
  const merged = useMergedResources("containers");
  // Group WITHIN each connection so identically-named groups on different engines never merge.
  const groups = useMemo(() => {
    const byConnection = new Map<string, MergedContainer[]>();
    for (const container of merged) {
      const list = byConnection.get(container.connectionId);
      if (list) {
        list.push(container);
      } else {
        byConnection.set(container.connectionId, [container]);
      }
    }
    return [...byConnection.values()].flatMap((list) => groupContainers(list, searchTerm, clientSort));
  }, [merged, searchTerm, clientSort]);
  // Composite selection/React key — ids collide across engines, so qualify each by its connection.
  const getRowId = useCallback((container: MergedContainer) => mergedKey(container, container.Id), []);
  // Flatten the groups into the exact ordered <tr> sequence (group header + members, collapse-aware),
  // then window it — only the visible rows reach the DOM. Replaces the progressive-reveal hook.
  const rows = useMemo(() => flattenGroups(groups, collapse, getRowId), [groups, collapse, getRowId]);
  const { scrollElementRef, theadRef, scrollMargin, getScrollElement } = useTableScroll();
  const { items, paddingTop, paddingBottom, measureRef } = useWindowedRows({
    rows,
    getScrollElement,
    getRowKey: getDescriptorKey,
    estimateRowHeight: estimateContainerRowHeight,
    scrollMargin,
    enabled: groups.length > 0,
  });
  const columnCount = 8 + (showEngineColumn ? 1 : 0);
  const visibleItems = useMemo(() => groups.flatMap((group) => group.Items) as MergedContainer[], [groups]);
  const visibleIds = useMemo(() => visibleItems.map(getRowId), [visibleItems, getRowId]);
  const selection = useBulkSelection(ID, visibleIds);
  const { actions: bulkActions, refresh: bulkRefresh } = useContainerBulkActions();
  const onReload = useResourceReload("containers");
  const actionsTitle = t("Actions");
  const onGroupToggleClick = useCallback((e) => {
    const groupName = e.currentTarget.getAttribute("data-prefix-group");
    setCollapse((prev) => ({ ...prev, [groupName]: !prev[groupName] }));
  }, []);
  const onContainerFocus = useCallback((e) => {
    const container = e.currentTarget.getAttribute("data-container-key");
    setContainerOverlay(container || undefined);
  }, []);
  const onContainerBlur = useCallback((e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setContainerOverlay(undefined);
    }
  }, []);
  const onContainerClearOverlay = useCallback(() => {
    setContainerOverlay(undefined);
  }, []);
  const onGroupMouseOver = useCallback((e) => {
    setContainerOverlay(undefined);
  }, []);
  const onContainerRequestOverlay = useCallback((e) => {
    const container = e.currentTarget.getAttribute("data-container-key") || undefined;
    setContainerOverlay((current) => (current === container ? current : container));
  }, []);

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
            <ActionsMenu onReload={onReload} />
          </>
        }
      />
      <div className="AppScreenContent" ref={scrollElementRef}>
        {groups.length === 0 ? (
          <NonIdealState
            icon={IconNames.GEOSEARCH}
            title={t("No results")}
            description={<p>{t("There are no containers")}</p>}
          />
        ) : (
          <HTMLTable compact interactive className="AppDataTable" data-windowed="true" data-table="containers">
            <thead ref={theadRef}>
              <tr>
                <SortableColumnHeader field="name" direction={getColumnSortDirection("name")} onSort={toggleColumnSort}>
                  <AppLabel iconName={IconNames.CUBE} text={t("Name")} />
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="image"
                  direction={getColumnSortDirection("image")}
                  onSort={toggleColumnSort}
                >
                  <AppLabel iconName={IconNames.BOX} text={t("Image")} />
                </SortableColumnHeader>
                <SortableColumnHeader field="pid" direction={getColumnSortDirection("pid")} onSort={toggleColumnSort}>
                  {t("Pid")}
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="state"
                  direction={getColumnSortDirection("state")}
                  onSort={toggleColumnSort}
                >
                  {t("State")}
                </SortableColumnHeader>
                <SortableColumnHeader field="id" direction={getColumnSortDirection("id")} onSort={toggleColumnSort}>
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
              <VirtualSpacerRow height={paddingTop} columnCount={columnCount} />
              {items.map(({ row: descriptor, index, key }) => {
                const striped = index % 2 === 0 ? "true" : undefined;
                if (descriptor.kind === "group-header") {
                  const group = descriptor.group;
                  const containers = group.Items as MergedContainer[];
                  const groupIds = containers.map(getRowId);
                  const groupSelectedCount = groupIds.reduce((n, id) => n + (selection.isSelected(id) ? 1 : 0), 0);
                  const groupChecked = groupIds.length > 0 && groupSelectedCount === groupIds.length;
                  const groupIndeterminate = groupSelectedCount > 0 && groupSelectedCount < groupIds.length;
                  const groupName = containers[0].Computed.Group;
                  const isCollapsed = groupName && !!collapse[groupName];
                  return (
                    <tr
                      key={key}
                      ref={measureRef}
                      data-index={index}
                      data-striped={striped}
                      className="AppDataTableGroupRow"
                      data-engine-row={showEngineRowAccent ? containers[0].engine : undefined}
                      onFocus={onContainerFocus}
                      onMouseOver={onGroupMouseOver}
                    >
                      <td className="AppDataTableGroupName">
                        <Button
                          variant="minimal"
                          icon={isCollapsed ? IconNames.CARET_RIGHT : IconNames.CARET_DOWN}
                          text={
                            <>
                              {group.Icon ? (
                                <>
                                  <Icon icon={group.Icon} /> &nbsp;
                                </>
                              ) : null}
                              <span className="buttonTextLabel">{groupName}</span>
                            </>
                          }
                          title={t("{{name}} containers group", {
                            name: groupName,
                          })}
                          onClick={onGroupToggleClick}
                          data-prefix-group={groupName}
                        />
                      </td>
                      <td colSpan={6}>
                        <div className="AppDataTableGroupDetails">
                          <ButtonGroup variant="minimal">
                            <Button icon={IconNames.SPLIT_COLUMNS} />
                          </ButtonGroup>
                          <ul className="ContainerReportStateCounts">
                            <li title={t("Total number of containers in this group")}>
                              # <span>{group.Items.length}</span>
                            </li>
                            <li data-state={ContainerStateList.RUNNING} data-count={group.Report.running}>
                              {t("Running")} <span>{group.Report.running}</span>
                            </li>
                            <li data-state={ContainerStateList.EXITED} data-count={group.Report.exited}>
                              {t("Exited")}
                              <span>{group.Report.exited}</span>
                            </li>
                          </ul>
                        </div>
                      </td>
                      <td className="BulkSelectColumn">
                        <SelectionCheckbox
                          checked={groupChecked}
                          indeterminate={groupIndeterminate}
                          onChange={() => selection.toggleMany(groupIds)}
                          title={t("Select all in group")}
                        />
                      </td>
                      <EngineColumnCell
                        visible={showEngineColumn}
                        engine={containers[0].engine}
                        connectionName={containers[0].connectionName}
                      />
                    </tr>
                  );
                }
                const container = descriptor.container;
                const { isPartOfGroup, isFirst, isLast } = descriptor;
                const rowId = key;
                const groupName = container.Computed.Group;
                const creationDate =
                  typeof container.Created === "string"
                    ? dayjs(container.Created)
                    : dayjs(Number(container.Created) * 1000);
                const image = container.Image;
                const nameText =
                  (isPartOfGroup ? container.Computed.NameInGroup : container.Computed.Name) || t("- n/a -");
                const containerLogsButton = (
                  <AppDataTableLink
                    className="ContainerLogsButton"
                    fillCell
                    href={pathTo(`/screens/container/${encodeURIComponent(container.Id)}/logs`, undefined, {
                      connId: container.connectionId,
                    })}
                    text={nameText.startsWith("/") ? nameText.slice(1) : nameText}
                    intent={Intent.SUCCESS}
                    iconName={IconNames.ALIGN_JUSTIFY}
                    title={t("Container logs")}
                  />
                );
                const containerLayersButton = (
                  <AppDataTableLink
                    className="ContainerLayersButton"
                    href={pathTo(`/screens/image/${encodeURIComponent(container.ImageID)}/layers`, undefined, {
                      connId: container.connectionId,
                    })}
                    text={image.split("@")[0]}
                    intent={Intent.PRIMARY}
                    iconName={IconNames.LAYERS}
                    title={t("Image layers history")}
                  />
                );
                let linkLocation: string | undefined = isFirst ? "first" : undefined;
                if (isLast) {
                  linkLocation = "last";
                }
                const groupLink = isPartOfGroup ? (
                  <div className="AppDataTableGroupLink" data-link-location={linkLocation}>
                    <div className="AppDataTableGroupLinkVertical"></div>
                    <div className="AppDataTableGroupLinkHorizontal"></div>
                  </div>
                ) : undefined;
                return (
                  <tr
                    key={key}
                    ref={measureRef}
                    data-index={index}
                    data-striped={striped}
                    data-prefix-group={isPartOfGroup ? groupName : undefined}
                    data-container={container.Id}
                    data-container-key={rowId}
                    data-engine-row={showEngineRowAccent ? container.engine : undefined}
                    data-state={container.Computed.DecodedState}
                    onFocus={onContainerFocus}
                    onBlur={onContainerBlur}
                    onMouseEnter={onContainerRequestOverlay}
                    onMouseLeave={onContainerClearOverlay}
                  >
                    <td>
                      {groupLink}
                      {containerLogsButton}
                    </td>
                    <td>{containerLayersButton}</td>
                    <td>
                      <Code title={container.Pid ? "" : t("Not available")}>{container.Pid || "n/a"}</Code>
                    </td>
                    <td>
                      <span className="ContainerState" data-state={container.Computed.DecodedState}>
                        {container.Computed.DecodedState}
                      </span>
                    </td>
                    <td>
                      <Code>{container.Id.substring(0, 12)}</Code>
                    </td>
                    <td>{creationDate.format("DD MMM YYYY HH:mm")}</td>
                    <td data-column="Actions">
                      {containerOverlay === rowId ? (
                        <ActionsMenu container={container} connectionId={container.connectionId} withOverlay />
                      ) : (
                        <ButtonGroup
                          className="ItemActionsMenu ResourceItemInlineActionsMenu"
                          data-actions-menu="container"
                        >
                          <Button variant="minimal" size="small" icon={IconNames.MORE} title={actionsTitle} />
                        </ButtonGroup>
                      )}
                    </td>
                    <td className="BulkSelectColumn">
                      <SelectionCheckbox
                        checked={selection.isSelected(rowId)}
                        onChange={() => selection.toggle(rowId)}
                      />
                    </td>
                    <EngineColumnCell
                      visible={showEngineColumn}
                      engine={container.engine}
                      connectionName={container.connectionName}
                    />
                  </tr>
                );
              })}
              <VirtualSpacerRow height={paddingBottom} columnCount={columnCount} />
            </tbody>
          </HTMLTable>
        )}
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Containers";
Screen.Route = {
  Path: `/screens/${ID}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.CUBE,
};
