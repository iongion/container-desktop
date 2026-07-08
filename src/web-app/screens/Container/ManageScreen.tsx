import {
  Button,
  ButtonGroup,
  Code,
  Divider,
  HTMLTable,
  Icon,
  Intent,
  MenuItem,
  NonIdealState,
  Spinner,
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { type Container, ContainerStateList } from "@/env/Types";
import { AppDataTableLink } from "@/web-app/components/AppDataTableLink";
import { AppLabel } from "@/web-app/components/AppLabel";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { BulkActionsBar, SelectionCheckbox, useBulkSelection } from "@/web-app/components/Bulk";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";
import { connectedConnections, isPodmanConnection } from "@/web-app/components/ConnectionSelect";
import { EngineCell, EngineColumnCell, EngineColumnHeader, engineLabel } from "@/web-app/components/EngineCell";
import { ResourceListActions } from "@/web-app/components/ResourceListActions";
import { SortableColumnHeader } from "@/web-app/components/SortableColumnHeader";
import { VirtualSpacerRow } from "@/web-app/components/VirtualSpacerRow";
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
import { useTableScroll, useWindowedRows } from "@/web-app/hooks/useWindowedRows";
import { pathTo } from "@/web-app/Navigator";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import { useStackHandoffStore } from "@/web-app/stores/stackHandoffStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { ActionsMenu } from ".";
import { useContainerBulkActions } from "./bulkActions";
import { isComposeGroup } from "./composeGroups";
import { tearDownStack } from "./composeQueries";
import { type ContainerConnectionGroup, type ContainerRowDescriptor, flattenGroups } from "./flattenGroups";
import { groupContainers } from "./grouping";
import { aggregateStatus, statusLabel, statusTone } from "./health";
import { ImportStackDrawer } from "./ImportStackDrawer";
import { enrichHealth, useComposeHealth } from "./useComposeHealth";
import "./ManageScreen.css";
import i18n from "@/i18n";

export interface ScreenProps extends AppScreenProps {}

export const ID = "containers";

// Always-merged: rows from every connected engine, each carrying its engine/connection.
type MergedContainer = MergedResource<Container>;
const COLUMN_COUNT = 8;

// Stable (module-level) virtualizer callbacks — avoids re-creating them per render.
const getDescriptorKey = (descriptor: ContainerRowDescriptor): string => descriptor.key;
const estimateContainerRowHeight = (descriptor: ContainerRowDescriptor): number =>
  descriptor.kind === "group-header" ? 34 : 28;

export const Screen: AppScreen<ScreenProps> = () => {
  const [containerOverlay, setContainerOverlay] = useState<string | undefined>();
  // The row whose actions popover is currently open. Its menu stays mounted even after the mouse leaves the
  // row (the popover portals below the row), so reaching for a menu item doesn't tear the popover down.
  const [pinnedRow, setPinnedRow] = useState<string | undefined>();
  const [collapse, setCollapse] = useState<{
    [key: string]: boolean | undefined;
  }>({});
  // Groups with an in-flight lifecycle action (start/stop/restart all, or stack teardown): show a spinner and
  // disable that group's controls until it settles. A Set so two groups can run independently.
  const [busyGroups, setBusyGroups] = useState<ReadonlySet<string>>(() => new Set());
  const markGroupBusy = useCallback((groupKey: string, busy: boolean) => {
    setBusyGroups((prev) => {
      const next = new Set(prev);
      if (busy) {
        next.add(groupKey);
      } else {
        next.delete(groupKey);
      }
      return next;
    });
  }, []);
  // Stacks are just compose-labelled container groups, so they live in this list: "Import stack" deploys a
  // compose file whose result shows up as a group here, tearable down from its group header.
  const [withImport, setWithImport] = useState(false);
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
  // Compose containers whose health the engine list omitted (podman compat) get it via a scoped inspect;
  // overlay it before grouping so the row dot + group rollup (both read Computed.Health) work uniformly.
  const composeHealth = useComposeHealth(merged);
  const withHealth = useMemo(() => enrichHealth(merged, composeHealth), [merged, composeHealth]);
  // Three-level tree: Connection → existing container group → container leaves. Group WITHIN each connection
  // so identically-named groups on different engines never merge.
  const connectionGroups = useMemo<ContainerConnectionGroup[]>(() => {
    const byConnection = new Map<string, MergedContainer[]>();
    for (const container of withHealth) {
      const list = byConnection.get(container.connectionId);
      if (list) {
        list.push(container);
      } else {
        byConnection.set(container.connectionId, [container]);
      }
    }
    const groups: ContainerConnectionGroup[] = [];
    for (const containers of byConnection.values()) {
      const first = containers[0];
      const containerGroups = groupContainers(containers, searchTerm, clientSort);
      if (first && containerGroups.length > 0) {
        groups.push({
          key: first.connectionId,
          connection: {
            id: first.connectionId,
            name: first.connectionName,
            engine: `${first.engine}`,
          },
          groups: containerGroups,
        });
      }
    }
    groups.sort((a, b) => sortAlphaNum(a.connection.name, b.connection.name));
    return groups;
  }, [withHealth, searchTerm, clientSort]);
  // Composite selection/React key — ids collide across engines, so qualify each by its connection.
  const getRowId = useCallback((container: MergedContainer) => mergedKey(container, container.Id), []);
  // Flatten the groups into the exact ordered <tr> sequence (group header + members, collapse-aware),
  // then window it — only the visible rows reach the DOM. Replaces the progressive-reveal hook.
  const rows = useMemo(
    () => flattenGroups(connectionGroups, collapse, getRowId),
    [connectionGroups, collapse, getRowId],
  );
  const { scrollElementRef, theadRef, scrollMargin, getScrollElement } = useTableScroll();
  const { items, paddingTop, paddingBottom, measureRef } = useWindowedRows({
    rows,
    getScrollElement,
    getRowKey: getDescriptorKey,
    estimateRowHeight: estimateContainerRowHeight,
    scrollMargin,
    enabled: connectionGroups.length > 0,
  });
  const columnCount = COLUMN_COUNT + (showEngineColumn ? 1 : 0);
  const visibleItems = useMemo(
    () =>
      connectionGroups.flatMap((connectionGroup) =>
        connectionGroup.groups.flatMap((group) => group.Items),
      ) as MergedContainer[],
    [connectionGroups],
  );
  const visibleIds = useMemo(() => visibleItems.map(getRowId), [visibleItems, getRowId]);
  const selection = useBulkSelection(ID, visibleIds);
  const { actions: bulkActions, refresh: bulkRefresh } = useContainerBulkActions();
  const onReload = useResourceReload("containers");
  const actionsTitle = t("Actions");
  const onGroupToggleClick = useCallback((e) => {
    const groupKey = e.currentTarget.getAttribute("data-prefix-group");
    setCollapse((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  }, []);
  // Project-level lifecycle for a container group (compose project or name-prefix group): apply the
  // existing per-container bulk action across the group's members, then refresh. Reuses the connection
  // routing + eligibility of useContainerBulkActions — no compose binary. "start" inherits the existing
  // unpause/restart-for-stopped semantics from bulkActions.
  const runGroupAction = useCallback(
    async (actionKey: string, containers: MergedContainer[], groupKey: string) => {
      const action = bulkActions.find((entry) => entry.key === actionKey);
      if (!action) {
        return;
      }
      const eligible = action.eligible ?? (() => true);
      markGroupBusy(groupKey, true);
      try {
        const results = await Promise.allSettled(containers.filter(eligible).map((container) => action.run(container)));
        await bulkRefresh();
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) {
          Notification.show({
            message: t("{{count}} container(s) could not {{action}}", { count: failed, action: actionKey }),
            intent: Intent.WARNING,
          });
        }
      } finally {
        markGroupBusy(groupKey, false);
      }
    },
    [bulkActions, bulkRefresh, markGroupBusy, t],
  );
  // Import stack (deploy a compose file) targets a Podman engine; its result becomes a compose group in this
  // very list. Default the drawer to the first connected Podman connection, keeping the user's pick if valid.
  const connections = useAppStore((state) => state.connections);
  const activeRuntime = useResourceStore((state) => state.activeRuntime);
  const podmanConnections = useMemo(
    () => connectedConnections(connections, activeRuntime, isPodmanConnection),
    [connections, activeRuntime],
  );
  const [importConnId, setImportConnId] = useState("");
  const composeConnId = podmanConnections.some((c) => c.id === importConnId)
    ? importConnId
    : (podmanConnections[0]?.id ?? "");
  const [handoffText, setHandoffText] = useState<string | null>(null);
  const openImport = useCallback(() => {
    setHandoffText(null);
    setWithImport(true);
  }, []);
  const closeImport = useCallback(() => {
    setWithImport(false);
    setHandoffText(null);
  }, []);
  // AI "Open in Stacks" handoff: raw generated compose text opens the Import drawer pre-filled.
  const pendingComposeText = useStackHandoffStore((s) => s.pendingComposeText);
  const setPendingComposeText = useStackHandoffStore((s) => s.setPendingComposeText);
  useEffect(() => {
    if (pendingComposeText) {
      setHandoffText(pendingComposeText);
      setPendingComposeText(null);
      setWithImport(true);
    }
  }, [pendingComposeText, setPendingComposeText]);
  // Tear a stack down from its compose-group header — removes the project's containers, networks and pod.
  const onStackTeardown = useCallback(
    async (project: string, connId: string, groupKey: string) => {
      markGroupBusy(groupKey, true);
      try {
        await tearDownStack(connId, project);
        await bulkRefresh();
        Notification.show({ message: t("Stack {{name}} removed", { name: project }), intent: Intent.SUCCESS });
      } catch (_error) {
        Notification.show({ message: t("Could not tear down the stack"), intent: Intent.DANGER });
      } finally {
        markGroupBusy(groupKey, false);
      }
    },
    [bulkRefresh, markGroupBusy, t],
  );
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
            <ResourceListActions
              actions={
                podmanConnections.length > 0
                  ? {
                      icon: IconNames.IMPORT,
                      text: t("Import stack"),
                      title: t("Import a stack from a compose file"),
                      onClick: openImport,
                    }
                  : undefined
              }
              onReload={onReload}
            />
          </>
        }
      />
      <div className="AppScreenContent" ref={scrollElementRef}>
        {connectionGroups.length === 0 ? (
          <NonIdealState
            icon={IconNames.GEOSEARCH}
            title={t("No results")}
            description={<p>{t("There are no containers")}</p>}
          />
        ) : (
          <HTMLTable
            compact
            interactive
            className="AppDataTable ContainersTreeTable"
            data-windowed="true"
            data-table="containers"
          >
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
                if (descriptor.kind === "connection-header") {
                  const connectionGroup = descriptor.connectionGroup;
                  const containers = connectionGroup.groups.flatMap((group) => group.Items) as MergedContainer[];
                  const connectionIds = containers.map(getRowId);
                  const connectionSelectedCount = connectionIds.reduce(
                    (n, id) => n + (selection.isSelected(id) ? 1 : 0),
                    0,
                  );
                  const connectionChecked =
                    connectionIds.length > 0 && connectionSelectedCount === connectionIds.length;
                  const connectionIndeterminate =
                    connectionSelectedCount > 0 && connectionSelectedCount < connectionIds.length;
                  const containerCount = containers.length;
                  const isCollapsed = !!collapse[descriptor.connectionKey];
                  return (
                    <tr
                      key={key}
                      ref={measureRef}
                      data-index={index}
                      data-striped={striped}
                      className="AppDataTableGroupRow ContainerConnectionRow"
                      data-engine-row={showEngineRowAccent ? connectionGroup.connection.engine : undefined}
                      onFocus={onContainerFocus}
                      onMouseOver={onGroupMouseOver}
                    >
                      <td className="AppDataTableGroupName" colSpan={COLUMN_COUNT - 1}>
                        <Button
                          variant="minimal"
                          icon={isCollapsed ? IconNames.CARET_RIGHT : IconNames.CARET_DOWN}
                          text={
                            <>
                              <EngineCell
                                engine={connectionGroup.connection.engine}
                                connectionName={connectionGroup.connection.name}
                              />
                              <span className="buttonTextLabel">{connectionGroup.connection.name}</span>
                              <span className="ContainerConnectionMeta">
                                {engineLabel(connectionGroup.connection.engine)}
                              </span>
                              <span className="ContainerConnectionSum">
                                {containerCount} {containerCount === 1 ? t("container") : t("containers")}
                              </span>
                            </>
                          }
                          title={t("{{name}} containers", {
                            name: connectionGroup.connection.name,
                          })}
                          onClick={onGroupToggleClick}
                          data-prefix-group={descriptor.connectionKey}
                        />
                      </td>
                      <td className="BulkSelectColumn">
                        <SelectionCheckbox
                          checked={connectionChecked}
                          indeterminate={connectionIndeterminate}
                          onChange={() => selection.toggleMany(connectionIds)}
                          title={t("Select all in connection")}
                        />
                      </td>
                      <EngineColumnCell
                        visible={showEngineColumn}
                        engine={connectionGroup.connection.engine}
                        connectionName={connectionGroup.connection.name}
                      />
                    </tr>
                  );
                }
                if (descriptor.kind === "group-header") {
                  const group = descriptor.group;
                  const containers = group.Items as MergedContainer[];
                  const groupIds = containers.map(getRowId);
                  const groupSelectedCount = groupIds.reduce((n, id) => n + (selection.isSelected(id) ? 1 : 0), 0);
                  const groupChecked = groupIds.length > 0 && groupSelectedCount === groupIds.length;
                  const groupIndeterminate = groupSelectedCount > 0 && groupSelectedCount < groupIds.length;
                  const groupName = containers[0].Computed.Group;
                  const groupKey = descriptor.groupKey;
                  const isCollapsed = !!collapse[groupKey];
                  // A single aggregate status ball for the group (worst member's tone), before the group name.
                  const groupStatus = aggregateStatus(containers);
                  const isGroupBusy = busyGroups.has(groupKey);
                  return (
                    <tr
                      key={key}
                      ref={measureRef}
                      data-index={index}
                      data-prefix-group={descriptor.connectionKey}
                      data-striped={striped}
                      className="AppDataTableGroupRow ContainerGroupRow"
                      data-engine-row={showEngineRowAccent ? containers[0].engine : undefined}
                      onFocus={onContainerFocus}
                      onMouseOver={onGroupMouseOver}
                    >
                      <td className="AppDataTableGroupName">
                        <div
                          className="AppDataTableGroupLink ContainerConnectionLink"
                          data-link-location={
                            descriptor.isLastInConnection && !descriptor.hasVisibleChildren ? "last" : undefined
                          }
                        >
                          <div className="AppDataTableGroupLinkVertical" />
                          <div className="AppDataTableGroupLinkHorizontal" />
                        </div>
                        <Button
                          variant="minimal"
                          icon={isCollapsed ? IconNames.CARET_RIGHT : IconNames.CARET_DOWN}
                          text={
                            <>
                              <span
                                className="ContainerStatus"
                                data-tone={groupStatus.tone}
                                title={groupStatus.label || undefined}
                              />
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
                          data-prefix-group={groupKey}
                        />
                      </td>
                      <td colSpan={5}>
                        <div className="AppDataTableGroupDetails">
                          <ButtonGroup variant="minimal" data-actions-menu="container-group">
                            <Button
                              icon={IconNames.PLAY}
                              disabled={isGroupBusy}
                              title={t("Start all in {{name}}", { name: groupName })}
                              onClick={() => runGroupAction("start", containers, groupKey)}
                            />
                            <Button
                              icon={IconNames.STOP}
                              disabled={isGroupBusy}
                              title={t("Stop all in {{name}}", { name: groupName })}
                              onClick={() => runGroupAction("stop", containers, groupKey)}
                            />
                            <Button
                              icon={IconNames.RESET}
                              disabled={isGroupBusy}
                              title={t("Restart all in {{name}}", { name: groupName })}
                              onClick={() => runGroupAction("restart", containers, groupKey)}
                            />
                          </ButtonGroup>
                          {isGroupBusy ? (
                            <Spinner size={16} className="ContainerGroupBusy" aria-label={t("Working…")} />
                          ) : null}
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
                      <td data-column="Actions">
                        {isComposeGroup(group) && groupName ? (
                          <ConfirmMenu
                            onConfirm={(_tag, confirmed) => {
                              if (confirmed) {
                                onStackTeardown(groupName, containers[0].connectionId, groupKey);
                              }
                            }}
                            tag={groupName}
                            title={t("Tear down stack {{name}} — remove its containers, networks and pod?", {
                              name: groupName,
                            })}
                          >
                            <MenuItem
                              icon={IconNames.PLAY}
                              text={t("Start all")}
                              disabled={isGroupBusy}
                              onClick={() => runGroupAction("start", containers, groupKey)}
                            />
                            <MenuItem
                              icon={IconNames.STOP}
                              text={t("Stop all")}
                              disabled={isGroupBusy}
                              onClick={() => runGroupAction("stop", containers, groupKey)}
                            />
                            <MenuItem
                              icon={IconNames.RESET}
                              text={t("Restart all")}
                              disabled={isGroupBusy}
                              onClick={() => runGroupAction("restart", containers, groupKey)}
                            />
                          </ConfirmMenu>
                        ) : null}
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
                const _groupName = container.Computed.Group;
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
                    prefix={
                      <span
                        className="ContainerStatus"
                        data-tone={statusTone(container)}
                        title={statusLabel(container) || undefined}
                      />
                    }
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
                  <>
                    {descriptor.isLastGroupInConnection ? null : (
                      <div className="AppDataTableGroupLink ContainerConnectionTrunk">
                        <div className="AppDataTableGroupLinkVertical" />
                      </div>
                    )}
                    <div className="AppDataTableGroupLink ContainerLeafLink" data-link-location={linkLocation}>
                      <div className="AppDataTableGroupLinkVertical" />
                      <div className="AppDataTableGroupLinkHorizontal" />
                    </div>
                  </>
                ) : (
                  <div
                    className="AppDataTableGroupLink ContainerConnectionLink"
                    data-link-location={descriptor.isLastGroupInConnection ? "last" : undefined}
                  >
                    <div className="AppDataTableGroupLinkVertical" />
                    <div className="AppDataTableGroupLinkHorizontal" />
                  </div>
                );
                return (
                  <tr
                    key={key}
                    ref={measureRef}
                    data-index={index}
                    data-striped={striped}
                    data-prefix-group={isPartOfGroup ? descriptor.groupKey : descriptor.connectionKey}
                    className={isPartOfGroup ? "ContainerNestedRow" : "ContainerConnectionLeafRow"}
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
                        {t(container.Computed.DecodedState)}
                      </span>
                    </td>
                    <td>
                      <Code>{container.Id.substring(0, 12)}</Code>
                    </td>
                    <td>{creationDate.format("DD MMM YYYY HH:mm")}</td>
                    <td data-column="Actions">
                      {containerOverlay === rowId || pinnedRow === rowId ? (
                        <ActionsMenu
                          container={container}
                          connectionId={container.connectionId}
                          withOverlay
                          onMenuOpenChange={(open) => setPinnedRow(open ? rowId : undefined)}
                        />
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
      {withImport ? (
        <ImportStackDrawer
          connectionId={composeConnId}
          onConnectionChange={setImportConnId}
          initialText={handoffText ?? undefined}
          onClose={closeImport}
        />
      ) : null}
    </div>
  );
};

Screen.ID = ID;
Screen.Title = i18n.t("Containers");
Screen.Route = {
  Path: `/screens/${ID}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.CUBE,
};
