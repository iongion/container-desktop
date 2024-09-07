import { AnchorButton, Button, ButtonGroup, Code, HTMLTable, Icon, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import dayjs from "dayjs";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { ContainerStateList } from "@/env/Types";
import { AppLabel } from "@/web-app/components/AppLabel";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { useStoreActions, useStoreState } from "@/web-app/domain/types";
import { usePoller } from "@/web-app/Hooks";
import { pathTo } from "@/web-app/Navigator";
import { AppScreen, AppScreenProps, ContainerGroup } from "@/web-app/Types";
import { ActionsMenu } from ".";
import "./ManageScreen.css";

export interface ScreenProps extends AppScreenProps {}

export const ID = "containers";

export const Screen: AppScreen<ScreenProps> = () => {
  const [containerOverlay, setContainerOverlay] = useState<string | undefined>();
  const [collapse, setCollapse] = useState<{ [key: string]: boolean | undefined }>({});
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { t } = useTranslation();
  const pending = useStoreState((state) => state.pending);
  const containersFetch = useStoreActions((actions) => actions.container.containersFetch);
  const groups: ContainerGroup[] = useStoreState((state) => state.container.containersGroupedByStrategy(searchTerm));
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
    [containerOverlay]
  );

  // Change hydration
  usePoller({ poller: containersFetch });

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader searchTerm={searchTerm} onSearch={onSearchChange} rightContent={<ActionsMenu onReload={containersFetch} />} />
      <div className="AppScreenContent">
        {groups.length === 0 && !pending ? (
          <NonIdealState icon={IconNames.GEOSEARCH} title={t("No results")} description={<p>{t("There are no containers")}</p>} />
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
                      const groupName = container.Computed.Group;
                      const isCollapsed = groupName && !!collapse[groupName];
                      const containerGroupRow =
                        isPartOfGroup && index === 0 ? (
                          <tr className="AppDataTableGroupRow" onFocus={onContainerFocus} onMouseOver={onGroupMouseOver}>
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
                                title={t("{{name}} containers group", { name: groupName })}
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
                      let containerGroupData;
                      if (!isCollapsed) {
                        // ui
                        const creationDate = typeof container.Created === "string" ? dayjs(container.Created) : dayjs(Number(container.Created) * 1000);
                        const image = container.Image;
                        const nameText = (isPartOfGroup ? container.Computed.NameInGroup : container.Computed.Name) || t("- n/a -");
                        const containerLogsButton = (
                          <AnchorButton
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
                          <div className="AppDataTableGroupLink" data-link-location={linkLocation}>
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
  Path: `/screens/${ID}`
};
Screen.Metadata = {
  LeftIcon: IconNames.CUBE
};
