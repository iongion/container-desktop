import { AnchorButton, Intent, HTMLTable, Code, Button } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import dayjs from "dayjs";

// project
import { AppScreenProps, AppScreen } from "../../Types";
import { usePoller } from "../../Hooks";
import { AppScreenHeader } from "../../components/AppScreenHeader";
import { useAppScreenSearch } from "../../components/AppScreenHooks";
import { pathTo } from "../../Navigator";
import { useStoreActions, useStoreState } from "../../domain/types";

// module
import { ActionsMenu } from ".";

import "./ManageScreen.css";
import { ContainerGroup, ContainerStateList } from "../../Types.container-app";
import React, { useCallback, useState } from "react";

export interface ScreenProps extends AppScreenProps {}

export const ID = "containers";

export const Screen: AppScreen<ScreenProps> = () => {
  const [collapse, setCollapse] = useState<{ [key: string]: boolean | undefined }>({});
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { t } = useTranslation();
  const containersFetch = useStoreActions((actions) => actions.container.containersFetch);
  const groups: ContainerGroup[] = useStoreState((state) => state.container.containersGroupedByPrefix(searchTerm));
  const onGroupToggleClick = useCallback((e) => {
    const groupName = e.currentTarget.getAttribute("data-group");
    setCollapse((prev) => ({ ...prev, [groupName]: !prev[groupName] }));
  }, []);

  // Change hydration
  usePoller({ poller: containersFetch });

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader onSearch={onSearchChange} />
      <div className="AppScreenContent">
        <HTMLTable condensed striped className="AppDataTable" data-table="containers">
          <thead>
            <tr>
              <th data-column="Name">{t("Name")}</th>
              <th data-column="Image">{t("Image")}</th>
              <th data-column="Pid">{t("Pid")}</th>
              <th data-column="State">{t("State")}</th>
              <th data-column="Digest">{t("Digest")}</th>
              <th data-column="Created">{t("Created")}</th>
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
                        <tr className="AppDataTableGroupRow">
                          <td className="AppDataTableGroupName">
                            <Button
                              minimal
                              icon={isCollapsed ? IconNames.CARET_RIGHT : IconNames.CARET_DOWN}
                              text={groupName}
                              onClick={onGroupToggleClick}
                              data-group={groupName}
                            />
                          </td>
                          <td className="AppDataTableGroupDetails" colSpan={6}>
                            <ul className="ContainerReportStateCounts">
                              <li data-state={ContainerStateList.RUNNING}>{t("Running")} <span>{group.Report.running}</span></li>
                              <li data-state={ContainerStateList.EXITED}>{t("Exited")}<span>{group.Report.exited}</span></li>
                            </ul>
                          </td>
                        </tr>
                      ) : undefined;
                    let containerGroupData;
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
                          className="ContainerLogsButton"
                          minimal
                          small
                          href={pathTo(`/screens/container/${encodeURIComponent(container.Id)}/logs`)}
                          text={nameText}
                          intent={Intent.SUCCESS}
                          icon={IconNames.CUBE}
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
                          icon={IconNames.BOX}
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
                          data-group={isPartOfGroup ? groupName : undefined}
                          data-container={container.Id}
                          data-state={container.Computed.DecodedState}
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
                          <td>{container.Id.substring(0, 12)}</td>
                          <td>{creationDate.format("DD MMM YYYY HH:mm")}</td>
                          <td>
                            <ActionsMenu container={container} />
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
