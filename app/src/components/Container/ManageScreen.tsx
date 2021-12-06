import { useCallback, useState, memo } from "react";
import { AnchorButton, Intent, HTMLTable } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import isEqual from "react-fast-compare";
import { useMediaQuery } from "react-responsive";

import dayjs from "dayjs";

import { AppScreen, Container } from "../../Types";
import { useStoreActions, useStoreState } from "../../Domain";
import { usePoller } from "../../Hooks";
import { ActionsMenu } from ".";
import { AppScreenHeader } from "../AppScreenHeader";
import { pathTo } from "../../Navigator";

import "./ManageScreen.css";

// List
interface ScreenListProps {
  items: Container[];
}

export const ScreenList: React.FC<ScreenListProps> = memo(({ items }) => {
  const { t } = useTranslation();
  const isCondensed = useMediaQuery({
    query: "(max-width: 1280px)"
  });
  return (
    <HTMLTable condensed striped className="AppDataTable" data-table="containers">
      <thead>
        <tr>
          {isCondensed ? (
            <th data-column="NameImage">{t("Name & Image")}</th>
          ) : (
            <>
              <th data-column="Name">{t("Name")}</th>
              <th data-column="Image">{t("Image")}</th>
            </>
          )}
          <th data-column="Pid">{t("Pid")}</th>
          <th data-column="State">{t("State")}</th>
          <th data-column="Status">{t("Status")}</th>
          <th data-column="Digest">{t("Digest")}</th>
          <th data-column="Created">{t("Created")}</th>
          <th data-column="Actions">&nbsp;</th>
        </tr>
      </thead>
      <tbody>
        {items.map((container) => {
          const image = container.Image;
          const containerLogsButton = (
            <AnchorButton
              minimal
              small
              href={pathTo(`/screens/container/${container.Id}/logs`)}
              text={container.Names[0] || t("- n/a -")}
              intent={Intent.SUCCESS}
              icon={IconNames.CUBE}
              title={t("Container logs")}
            />
          );
          const containerLayersButton = (
            <AnchorButton
              minimal
              small
              href={pathTo(`/screens/image/${container.ImageID}/layers`)}
              text={image}
              intent={Intent.PRIMARY}
              icon={IconNames.BOX}
              title={t("Image layers history")}
            />
          );
          return (
            <tr key={container.Id} data-container={container.Id}>
              {isCondensed ? (
                <td>
                  {containerLogsButton} {containerLayersButton}
                </td>
              ) : (
                <>
                  <td>{containerLogsButton}</td>
                  <td>{containerLayersButton}</td>
                </>
              )}
              <td>
                <code>{container.Pid}</code>
              </td>
              <td>{typeof container.State === "string" ? container.State : container.State.Status}</td>
              <td>{container.Status || t("- n/a -")}</td>
              <td>{container.Id.substr(0, 12)}</td>
              <td>{(dayjs(container.Created) as any).fromNow()}</td>
              <td>
                <ActionsMenu container={container} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </HTMLTable>
  );
}, isEqual);
// Screen

interface ScreenProps {}

export const ID = "containers";

export const Screen: AppScreen<ScreenProps> = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const containersFetch = useStoreActions((actions) => actions.containersFetch);
  const containers = useStoreState((state) => state.containersSearchByTerm(searchTerm));
  // Event handlers
  const onSearchChange = useCallback(
    (e) => {
      const needle = e.currentTarget.value.toLowerCase();
      setSearchTerm(needle);
    },
    [setSearchTerm]
  );

  // Change hydration
  usePoller({ poller: containersFetch });

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader onSearch={onSearchChange} />
      <div className="AppScreenContent">
        <ScreenList items={containers} />
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
