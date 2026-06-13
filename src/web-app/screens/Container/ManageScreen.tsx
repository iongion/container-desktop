import { AnchorButton, Button, ButtonGroup, Code, HTMLTable, Icon, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import dayjs from "dayjs";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { v4 } from "uuid";

import { type Container, ContainerStateList } from "@/env/Types";
import { AppLabel } from "@/web-app/components/AppLabel";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { sortAlphaNum } from "@/web-app/domain/utils";
import { pathTo } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import { resourceEvents } from "@/web-app/stores/resourceEvents";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import type { AppScreen, AppScreenProps, ContainerGroup } from "@/web-app/Types";
import { ActionsMenu } from ".";
import "./ManageScreen.css";

export interface ScreenProps extends AppScreenProps {}

export const ID = "containers";

const EMPTY_CONTAINERS: Container[] = [];

const createContainerSearchFilter = (searchTerm: string) => {
  const query = searchTerm.toLowerCase();
  return (it: Container) => {
    const haystacks = [it.Names[0] || "", it.Image, it.Id, `${it.Pid}`, `${it.Size}`].map((t) => t.toLowerCase());
    const matching = haystacks.find((it) => it.includes(query));
    return !!matching;
  };
};

function groupContainers(containers: Container[], searchTerm: string): ContainerGroup[] {
  let source = [...containers].sort((a, b) => {
    if (a.Computed.Name && b.Computed.Name) {
      return sortAlphaNum(a.Computed.Name, b.Computed.Name);
    }
    return sortAlphaNum(a.CreatedAt, b.CreatedAt);
  });
  if (searchTerm) {
    source = source.filter(createContainerSearchFilter(searchTerm));
  }
  let groups: ContainerGroup[] = [];
  const groupsMap: { [key: string]: ContainerGroup } = {};
  source.forEach((it) => {
    if (!it.Computed.Group) {
      return;
    }
    let group = groupsMap[it.Computed.Group];
    if (!group) {
      group = {
        Id: v4(),
        Name: it.Computed.Group,
        Items: [],
        Report: {
          [ContainerStateList.CREATED]: 0,
          [ContainerStateList.ERROR]: 0,
          [ContainerStateList.EXITED]: 0,
          [ContainerStateList.PAUSED]: 0,
          [ContainerStateList.RUNNING]: 0,
          [ContainerStateList.DEGRADED]: 0,
          [ContainerStateList.STOPPED]: 0,
        },
        Weight: 1000,
      };
      groups.push(group);
      groupsMap[it.Computed.Group] = group;
    }
    group.Report[it.Computed.DecodedState] += 1;
    if (group.Items.length > 0) {
      group.Weight = -1;
    }
    if (group.Name === "Pod infrastructure") {
      group.Weight = -100;
      group.Icon = IconNames.CUBE_ADD;
    }
    group.Items.push(it);
  });
  groups = groups.sort((a, b) => sortAlphaNum(a.Name || "", b.Name || ""));
  groups = groups.sort((a, b) => a.Weight - b.Weight);
  return groups;
}

export const Screen: AppScreen<ScreenProps> = () => {
  const [containerOverlay, setContainerOverlay] = useState<string | undefined>();
  const [collapse, setCollapse] = useState<{
    [key: string]: boolean | undefined;
  }>({});
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { t } = useTranslation();
  const connectionId = useAppStore((state) => state.currentConnector?.id);
  const containers = useResourceStore((state) =>
    connectionId ? state.byConnection[connectionId]?.containers.items || EMPTY_CONTAINERS : EMPTY_CONTAINERS,
  );
  const groups = useMemo(() => groupContainers(containers, searchTerm), [containers, searchTerm]);
  const onReload = useCallback(() => {
    if (connectionId) {
      resourceEvents.refresh(connectionId, "containers");
    }
  }, [connectionId]);
  const onGroupToggleClick = useCallback((e) => {
    const groupName = e.currentTarget.getAttribute("data-prefix-group");
    setCollapse((prev) => ({ ...prev, [groupName]: !prev[groupName] }));
  }, []);
  const onContainerFocus = useCallback((e) => {}, []);
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
        rightContent={<ActionsMenu onReload={onReload} />}
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
                <th data-column="Name">
                  <AppLabel iconName={IconNames.CUBE} text={t("Name")} />
                </th>
                <th data-column="Image">
                  <AppLabel iconName={IconNames.BOX} text={t("Image")} />
                </th>
                <th data-column="Pid">{t("Pid")}</th>
                <th data-column="State">{t("State")}</th>
                <th data-column="Id">
                  <AppLabel iconName={IconNames.BARCODE} text={t("Id")} />
                </th>
                <th data-column="Created">
                  <AppLabel iconName={IconNames.CALENDAR} text={t("Created")} />
                </th>
                <th data-column="Actions">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const containers = group.Items;
                const isPartOfGroup = group.Items.length > 1;
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
                          </tr>
                        ) : undefined;
                      let containerGroupData: React.ReactNode | null = null;
                      if (!isCollapsed) {
                        // ui
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
                            onMouseOver={onContainerRequestOverlay}
                            onPointerDown={onContainerRequestOverlay}
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
