import {
  AnchorButton,
  Button,
  ButtonGroup,
  Code,
  Divider,
  HTMLTable,
  Icon,
  Intent,
  NonIdealState,
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import dayjs from "dayjs";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { type Container, ContainerStateList } from "@/env/Types";
import { AppLabel } from "@/web-app/components/AppLabel";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { BulkActionsBar, SelectionCheckbox, useBulkSelection } from "@/web-app/components/Bulk";
import { SortableColumnHeader } from "@/web-app/components/SortableColumnHeader";
import { useColumnSort } from "@/web-app/hooks/useColumnSort";
import { pathTo } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import { resourceEvents } from "@/web-app/stores/resourceEvents";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { ActionsMenu } from ".";
import { useContainerBulkActions } from "./bulkActions";
import { groupContainers } from "./grouping";
import "./ManageScreen.css";

export interface ScreenProps extends AppScreenProps {}

export const ID = "containers";

const EMPTY_CONTAINERS: Container[] = [];

export const Screen: AppScreen<ScreenProps> = () => {
  const [containerOverlay, setContainerOverlay] = useState<string | undefined>();
  const [collapse, setCollapse] = useState<{
    [key: string]: boolean | undefined;
  }>({});
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { t } = useTranslation();
  const currentConnector = useAppStore((state) => state.currentConnector);
  const connectionId = currentConnector?.id;
  const { clientSort, getColumnSortDirection, toggleColumnSort } = useColumnSort(
    ID,
    currentConnector?.capabilities?.sort,
  );
  const containers = useResourceStore((state) =>
    connectionId ? state.byConnection[connectionId]?.containers.items || EMPTY_CONTAINERS : EMPTY_CONTAINERS,
  );
  const groups = useMemo(
    () => groupContainers(containers, searchTerm, clientSort),
    [clientSort, containers, searchTerm],
  );
  const visibleItems = useMemo(() => groups.flatMap((group) => group.Items), [groups]);
  const visibleIds = useMemo(() => visibleItems.map((item) => item.Id), [visibleItems]);
  const selection = useBulkSelection(ID, visibleIds);
  const { actions: bulkActions, getId: bulkGetId, refresh: bulkRefresh } = useContainerBulkActions(connectionId || "");
  const onReload = useCallback(() => {
    if (connectionId) {
      resourceEvents.refresh(connectionId, "containers");
    }
  }, [connectionId]);
  const onGroupToggleClick = useCallback((e) => {
    const groupName = e.currentTarget.getAttribute("data-prefix-group");
    setCollapse((prev) => ({ ...prev, [groupName]: !prev[groupName] }));
  }, []);
  const onContainerFocus = useCallback((e) => {
    const container = e.currentTarget.getAttribute("data-container");
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
  const onContainerRequestOverlay = useCallback(
    (e) => {
      const container = e.currentTarget.getAttribute("data-container");
      if (containerOverlay !== container) {
        setContainerOverlay(container);
      }
    },
    [containerOverlay],
  );

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
                  getId={bulkGetId}
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
      <div className="AppScreenContent">
        {groups.length === 0 ? (
          <NonIdealState
            icon={IconNames.GEOSEARCH}
            title={t("No results")}
            description={<p>{t("There are no containers")}</p>}
          />
        ) : (
          <HTMLTable compact striped interactive className="AppDataTable" data-table="containers">
            <thead>
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
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const containers = group.Items;
                const isPartOfGroup = group.Items.length > 1;
                const groupIds = containers.map((it) => it.Id);
                const groupSelectedCount = groupIds.reduce((n, id) => n + (selection.isSelected(id) ? 1 : 0), 0);
                const groupChecked = groupIds.length > 0 && groupSelectedCount === groupIds.length;
                const groupIndeterminate = groupSelectedCount > 0 && groupSelectedCount < groupIds.length;
                return (
                  <React.Fragment key={group.Name || group.Id}>
                    {containers.map((container, index) => {
                      const renderKey = `containerRowKey-${group.Name || group.Id}-${container.Id}`;
                      const groupName = container.Computed.Group;
                      const isCollapsed = groupName && !!collapse[groupName];
                      const containerGroupItemKey = `containerGroupKey-${group.Name || group.Id}-${container.Id}`;
                      const containerGroupRow =
                        isPartOfGroup && index === 0 ? (
                          <tr
                            key={containerGroupItemKey}
                            className="AppDataTableGroupRow"
                            onFocus={onContainerFocus}
                            onMouseOver={onGroupMouseOver}
                          >
                            <td className="AppDataTableGroupName">
                              <Button
                                minimal
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
                                <ButtonGroup minimal>
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
                          </tr>
                        ) : undefined;
                      let containerGroupData: React.ReactNode | null = null;
                      if (!isCollapsed) {
                        const creationDate =
                          typeof container.Created === "string"
                            ? dayjs(container.Created)
                            : dayjs(Number(container.Created) * 1000);
                        const image = container.Image;
                        const nameText =
                          (isPartOfGroup ? container.Computed.NameInGroup : container.Computed.Name) || t("- n/a -");
                        const containerLogsButton = (
                          <AnchorButton
                            key={`${renderKey}-logs`}
                            className="ContainerLogsButton"
                            minimal
                            small
                            href={pathTo(`/screens/container/${encodeURIComponent(container.Id)}/logs`)}
                            text={nameText.startsWith("/") ? nameText.slice(1) : nameText}
                            intent={Intent.SUCCESS}
                            icon={IconNames.ALIGN_JUSTIFY}
                            title={t("Container logs")}
                          />
                        );
                        const containerLayersButton = (
                          <AnchorButton
                            key={`${renderKey}-layers`}
                            className="ContainerLayersButton"
                            minimal
                            small
                            href={pathTo(`/screens/image/${encodeURIComponent(container.ImageID)}/layers`)}
                            text={image.split("@")[0]}
                            intent={Intent.PRIMARY}
                            icon={IconNames.LAYERS}
                            title={t("Image layers history")}
                          />
                        );
                        const isFirst = index === 0;
                        let linkLocation = isFirst ? "first" : undefined;
                        if (index === containers.length - 1) {
                          linkLocation = "last";
                        }
                        const groupLink = isPartOfGroup ? (
                          <div
                            key={`${renderKey}-group-link`}
                            className="AppDataTableGroupLink"
                            data-link-location={linkLocation}
                          >
                            <div className="AppDataTableGroupLinkVertical"></div>
                            <div className="AppDataTableGroupLinkHorizontal"></div>
                          </div>
                        ) : undefined;
                        containerGroupData = (
                          <tr
                            data-prefix-group={isPartOfGroup ? groupName : undefined}
                            data-container={container.Id}
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
                            <td>
                              <ActionsMenu container={container} withOverlay={containerOverlay === container.Id} />
                            </td>
                            <td className="BulkSelectColumn">
                              <SelectionCheckbox
                                checked={selection.isSelected(container.Id)}
                                onChange={() => selection.toggle(container.Id)}
                              />
                            </td>
                          </tr>
                        );
                      }
                      const row = (
                        <React.Fragment key={container.Id}>
                          {containerGroupRow}
                          {containerGroupData}
                        </React.Fragment>
                      );
                      return row;
                    })}
                  </React.Fragment>
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
Screen.Title = "Containers";
Screen.Route = {
  Path: `/screens/${ID}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.CUBE,
};
