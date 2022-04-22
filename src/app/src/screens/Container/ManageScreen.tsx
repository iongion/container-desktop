import { AnchorButton, Intent, HTMLTable, Code } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import { useMediaQuery } from "react-responsive";

import dayjs from "dayjs";

// project
import { AppScreenProps, AppScreen, Container } from "../../Types";
import { usePoller } from "../../Hooks";
import { AppScreenHeader } from "../../components/AppScreenHeader";
import { useAppScreenSearch } from "../../components/AppScreenHooks";
import { pathTo } from "../../Navigator";
import { useStoreActions, useStoreState } from "../../domain/types";

// module
import { ActionsMenu } from ".";

import "./ManageScreen.css";

export interface ScreenProps extends AppScreenProps {}

export const ID = "containers";

export const Screen: AppScreen<ScreenProps> = () => {
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { t } = useTranslation();
  const isCondensed = useMediaQuery({
    query: "(max-width: 1280px)"
  });
  const containersFetch = useStoreActions((actions) => actions.container.containersFetch);
  const containers: Container[] = useStoreState((state) => state.container.containersSearchByTerm(searchTerm));

  // Change hydration
  usePoller({ poller: containersFetch });

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader onSearch={onSearchChange} />
      <div className="AppScreenContent">
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
              <th data-column="Digest">{t("Digest")}</th>
              <th data-column="Created">{t("Created")}</th>
              <th data-column="Actions">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {containers.map((container) => {
              const creationDate = typeof container.Created === "string" ? dayjs(container.Created) : dayjs(Number(container.Created) * 1000);
              const image = container.Image;
              const containerLogsButton = (
                <AnchorButton
                  minimal
                  small
                  href={pathTo(`/screens/container/${encodeURIComponent(container.Id)}/logs`)}
                  text={container.Names[0] || t("- n/a -")}
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
                    <Code title={container.Pid ? "" : t("Not available")}>{container.Pid || "n/a"}</Code>
                  </td>
                  <td>{container.DecodedState}</td>
                  <td>{container.Id.substr(0, 12)}</td>
                  <td>{creationDate.format("DD MMM YYYY HH:mm")}</td>
                  <td>
                    <ActionsMenu container={container} />
                  </td>
                </tr>
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
