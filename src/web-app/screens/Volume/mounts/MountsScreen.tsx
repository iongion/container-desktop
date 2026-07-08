import { Button, HTMLTable, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import prettyBytes from "pretty-bytes";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  type MountProbeResponse,
  type MountProbeResult,
  mountProbeKey,
  RESOURCE_SYNC,
} from "@/container-client/resourceSyncProtocol";
import i18n from "@/i18n";
import { AppDataTableLink } from "@/web-app/components/AppDataTableLink";
import { AppLabel } from "@/web-app/components/AppLabel";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { EngineCell, engineLabel } from "@/web-app/components/EngineCell";
import { useGroupedVirtualRows } from "@/web-app/components/groupedTable/useGroupedVirtualRows";
import { ResourceListActions } from "@/web-app/components/ResourceListActions";
import { SortableColumnHeader } from "@/web-app/components/SortableColumnHeader";
import { VirtualSpacerRow } from "@/web-app/components/VirtualSpacerRow";
import { useColumnSort } from "@/web-app/hooks/useColumnSort";
import { useMergedResources, useResourcesReload, useShowEngineRowAccent } from "@/web-app/hooks/useMergedResources";
import { Notification } from "@/web-app/Notification";
import { getContainerUrl } from "@/web-app/screens/Container/Navigation";
import { useAppStore } from "@/web-app/stores/appStore";
import { useSortStore } from "@/web-app/stores/sortStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ScreenHeaderSectionsTabBar } from "../ScreenHeader";
import { buildMountGroups, type MountGroup, type MountSort } from "./mountRows";
import "./MountsInspector.css";

export const ID = "volumes.mounts";
export const Title = i18n.t("Mounts");

const COLUMN_COUNT = 7;
const MOUNT_SORT_CAPABILITIES = { [`${ID}.*`]: "client" } as const;
const DEFAULT_MOUNT_SORT: MountSort = { field: "mount", dir: "asc" };

export interface ScreenProps extends AppScreenProps {}

const indexProbeResults = (response: MountProbeResponse | undefined): Record<string, MountProbeResult> =>
  Object.fromEntries((response?.results ?? []).map((result) => [result.key, result]));

// Mounts inspector — GLOBAL tree grid: Connection (group) → Container (shown once, links to its logs) → Mount
// leaves, so a container appears once and its mounts nest beneath it. Merges every connection's bind + volume
// mounts from the already-loaded container list (owner from the volume list), rendered through the shared
// grouped+virtualized table (useGroupedVirtualRows) — same plumbing as the Containers / Volumes / Registries
// lists. Containers + mounts are ordered alphanumerically, like a file system. Backend, latency and health are
// probe-only and shown as honest placeholders until the probes land. Reached via the Volumes navbar tab
// navigator; not a sidebar entry.
export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const [probeResults, setProbeResults] = useState<Record<string, MountProbeResult>>({});
  const [probePending, setProbePending] = useState(false);
  const [hasUserChangedSort, setHasUserChangedSort] = useState(false);
  const initialSortRef = useRef(useSortStore.getState().sorts[ID]);
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const currentConnector = useAppStore((state) => state.currentConnector);
  const sortCapabilities = useMemo(
    () => ({ ...(currentConnector?.capabilities?.sort ?? {}), ...MOUNT_SORT_CAPABILITIES }),
    [currentConnector?.capabilities?.sort],
  );
  const { clientSort, toggleColumnSort } = useColumnSort(ID, sortCapabilities);
  const clearSort = useSortStore((state) => state.clearSort);
  const effectiveClientSort = useMemo<MountSort>(
    () =>
      !hasUserChangedSort && initialSortRef.current?.field && initialSortRef.current.field !== "mount"
        ? DEFAULT_MOUNT_SORT
        : ((clientSort as MountSort | undefined) ?? DEFAULT_MOUNT_SORT),
    [clientSort, hasUserChangedSort],
  );
  const getMountColumnSortDirection = useCallback(
    (field: string) => (effectiveClientSort.field === field ? effectiveClientSort.dir : undefined),
    [effectiveClientSort],
  );
  const onMountColumnSort = useCallback(
    (field: string) => {
      if (!hasUserChangedSort && initialSortRef.current?.field && initialSortRef.current.field !== "mount") {
        clearSort(ID);
      }
      setHasUserChangedSort(true);
      toggleColumnSort(field);
    },
    [clearSort, hasUserChangedSort, toggleColumnSort],
  );
  const isGlobalMountSort = effectiveClientSort.field !== "mount";
  const containers = useMergedResources("containers");
  const volumes = useMergedResources("volumes");
  const groups = useMemo(
    () => buildMountGroups(containers, volumes, searchTerm, effectiveClientSort),
    [containers, effectiveClientSort, searchTerm, volumes],
  );
  const { items, paddingTop, paddingBottom, measureRef, scrollElementRef, theadRef, isCollapsed, onGroupToggleClick } =
    useGroupedVirtualRows({ groups, getRowKey: (item) => item.key });
  const showEngineRowAccent = useShowEngineRowAccent();
  const onReload = useResourcesReload("containers", "volumes");
  const onTestMounts = useCallback(async () => {
    setProbePending(true);
    try {
      const response = (await window.MessageBus.invoke(RESOURCE_SYNC.probeMounts)) as MountProbeResponse;
      const nextResults = indexProbeResults(response);
      const failedCount = Object.values(nextResults).filter((result) => !result.healthy).length;
      setProbeResults(nextResults);
      Notification.show({
        message:
          failedCount > 0
            ? t("Mount checks completed with {{count}} failed.", { count: failedCount })
            : t("Mount checks completed."),
        intent: failedCount > 0 ? Intent.WARNING : Intent.SUCCESS,
      });
    } catch (error: any) {
      Notification.show({
        message: t("Mount checks failed: {{message}}", { message: error?.message ?? `${error}` }),
        intent: Intent.DANGER,
      });
    } finally {
      setProbePending(false);
    }
  }, [t]);

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader
        searchTerm={searchTerm}
        onSearch={onSearchChange}
        rightContent={
          <ResourceListActions
            actions={{
              disabled: probePending,
              icon: IconNames.PULSE,
              loading: probePending,
              text: t("Test mounts"),
              title: t("Run mount checks"),
              onClick: onTestMounts,
            }}
            navigation={<ScreenHeaderSectionsTabBar isActive={(screen) => screen === ID} />}
            onReload={onReload}
          />
        }
      />
      <div className="AppScreenContent" ref={scrollElementRef}>
        {groups.length === 0 ? (
          <NonIdealState
            icon={IconNames.FOLDER_SHARED}
            title={t("No mounts")}
            description={<p>{t("No bind mounts or volumes are mounted across the connected engines.")}</p>}
          />
        ) : (
          <HTMLTable
            compact
            interactive
            className="AppDataTable GroupedTable MountsTable"
            data-windowed="true"
            data-table="mounts"
          >
            <thead ref={theadRef}>
              <tr>
                <SortableColumnHeader
                  field="mount"
                  direction={getMountColumnSortDirection("mount")}
                  onSort={onMountColumnSort}
                >
                  <AppLabel iconName={IconNames.CUBE} text={t("Container / Mount")} />
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="type"
                  direction={getMountColumnSortDirection("type")}
                  onSort={onMountColumnSort}
                >
                  {t("Type")}
                </SortableColumnHeader>
                <th>{t("Backend")}</th>
                <SortableColumnHeader
                  field="mode"
                  direction={getMountColumnSortDirection("mode")}
                  onSort={onMountColumnSort}
                >
                  {t("Mode")}
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="owner"
                  direction={getMountColumnSortDirection("owner")}
                  onSort={onMountColumnSort}
                >
                  {t("Owner")}
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="size"
                  direction={getMountColumnSortDirection("size")}
                  onSort={onMountColumnSort}
                >
                  {t("Size")}
                </SortableColumnHeader>
                <th>{t("Health")}</th>
              </tr>
            </thead>
            <tbody>
              <VirtualSpacerRow height={paddingTop} columnCount={COLUMN_COUNT} />
              {items.map(({ row: descriptor, index, key }) => {
                const striped = index % 2 === 0 ? "true" : undefined;
                if (descriptor.kind === "group-header") {
                  const group = descriptor.group as MountGroup;
                  const collapsed = isCollapsed(group.key);
                  const mountCount = group.items.filter((item) => item.kind === "mount").length;
                  return (
                    <tr
                      key={key}
                      ref={measureRef}
                      data-index={index}
                      className="AppDataTableGroupRow"
                      data-engine-row={showEngineRowAccent ? group.connection.engine : undefined}
                    >
                      <td className="AppDataTableGroupName" colSpan={COLUMN_COUNT}>
                        <Button
                          variant="minimal"
                          icon={collapsed ? IconNames.CARET_RIGHT : IconNames.CARET_DOWN}
                          onClick={onGroupToggleClick}
                          data-prefix-group={group.key}
                          title={t("{{name}} mounts", { name: group.connection.name })}
                          text={
                            <>
                              <EngineCell engine={group.connection.engine} connectionName={group.connection.name} />
                              <span className="buttonTextLabel">{group.connection.name}</span>
                              <span className="GroupedTableGroupMeta">{engineLabel(group.connection.engine)}</span>
                              <span className="GroupedTableGroupSum">
                                {mountCount} {mountCount === 1 ? t("mount") : t("mounts")}
                              </span>
                            </>
                          }
                        />
                      </td>
                    </tr>
                  );
                }
                const item = descriptor.item;
                if (item.kind === "container") {
                  const node = item.container;
                  return (
                    <tr
                      key={key}
                      ref={measureRef}
                      data-index={index}
                      data-prefix-group={node.connectionId}
                      data-striped={striped}
                      className="MountContainerRow"
                      data-engine-row={showEngineRowAccent ? node.engine : undefined}
                    >
                      <td>
                        <div
                          className="AppDataTableGroupLink"
                          data-link-location={item.isLastContainer ? "last" : undefined}
                        >
                          <div className="AppDataTableGroupLinkVertical" />
                          <div className="AppDataTableGroupLinkHorizontal" />
                        </div>
                        <AppDataTableLink
                          href={getContainerUrl(node.containerId, "inspect", node.connectionId)}
                          text={node.containerName}
                          iconName={IconNames.CUBE}
                          title={t("Container details")}
                        />
                      </td>
                      <td />
                      <td />
                      <td />
                      <td />
                      <td />
                      <td />
                    </tr>
                  );
                }
                const row = item.mount;
                const probe =
                  probeResults[
                    mountProbeKey({
                      connectionId: row.connectionId,
                      containerId: row.containerId,
                      source: row.source,
                      destination: row.destination,
                    })
                  ];
                return (
                  <tr
                    key={key}
                    ref={measureRef}
                    data-index={index}
                    data-prefix-group={row.connectionId}
                    data-striped={striped}
                    className={isGlobalMountSort ? "MountLeaf MountLeafGlobalSort" : "MountLeaf"}
                    data-engine-row={showEngineRowAccent ? row.engine : undefined}
                  >
                    <td>
                      {isGlobalMountSort ? (
                        <div className="MountGlobalCell">
                          <AppDataTableLink
                            className="MountGlobalContainerLink"
                            href={getContainerUrl(row.containerId, "inspect", row.connectionId)}
                            text={row.containerName}
                            iconName={IconNames.CUBE}
                            title={t("Container details")}
                          />
                          <div className="MountPath">
                            <span className={row.source ? "MountSrc" : "MountSrc MountMuted"}>
                              {row.source || t("anonymous")}
                            </span>
                            <span className="MountArrow">→</span>
                            <span className="MountDst">{row.destination}</span>
                          </div>
                        </div>
                      ) : (
                        <>
                          {item.parentIsLastContainer ? null : (
                            <div className="AppDataTableGroupLink MountTrunk">
                              <div className="AppDataTableGroupLinkVertical" />
                            </div>
                          )}
                          <div
                            className="AppDataTableGroupLink MountLeafLink"
                            data-link-location={item.isLastInContainer ? "last" : undefined}
                          >
                            <div className="AppDataTableGroupLinkVertical" />
                            <div className="AppDataTableGroupLinkHorizontal" />
                          </div>
                          <div className="MountPath">
                            <span className={row.source ? "MountSrc" : "MountSrc MountMuted"}>
                              {row.source || t("anonymous")}
                            </span>
                            <span className="MountArrow">→</span>
                            <span className="MountDst">{row.destination}</span>
                          </div>
                        </>
                      )}
                    </td>
                    <td>
                      <span className="MountTag">{row.type || "—"}</span>
                    </td>
                    <td>
                      {probe ? (
                        <span className="MountTag">
                          {probe.backend || (probe.healthy ? t("reachable") : t("unreachable"))}
                        </span>
                      ) : (
                        <span className="MountMuted">—</span>
                      )}
                    </td>
                    <td>
                      {row.mode ? <span className="MountMode">{row.mode}</span> : <span className="MountMuted">—</span>}
                    </td>
                    <td>
                      {row.owner ? (
                        <span className="MountMono">{row.owner}</span>
                      ) : (
                        <span className="MountMuted">—</span>
                      )}
                    </td>
                    <td>
                      {typeof row.size === "number" ? prettyBytes(row.size) : <span className="MountMuted">—</span>}
                    </td>
                    <td>
                      {probe ? (
                        <span className="MountHealth" data-health={probe.healthy ? "ok" : "error"} title={probe.error}>
                          {probe.healthy ? `${t("OK")} ${probe.latencyMs}ms` : t("Failed")}
                        </span>
                      ) : (
                        <span className="MountMuted">—</span>
                      )}
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
Screen.Title = Title;
Screen.Route = {
  Path: "/screens/volumes/mounts",
};
Screen.Metadata = {
  LeftIcon: IconNames.FOLDER_SHARED,
  ExcludeFromSidebar: true,
};
