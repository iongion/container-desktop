import { AnchorButton, HTMLTable, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import { mdiScrewdriver } from "@mdi/js";

// project
import { Volume } from "../../Types.container-app";
import { AppScreenProps, AppScreen } from "../../Types";
import { usePoller } from "../../Hooks";
import { AppScreenHeader } from "../../components/AppScreenHeader";
import { useAppScreenSearch } from "../../components/AppScreenHooks";
import { useStoreActions, useStoreState } from "../../domain/types";
import { AppLabel } from "../../components/AppLabel";
import { getVolumeUrl } from "./Navigation";

// module
import { VolumeActionsMenu } from ".";

import "./ManageScreen.css";

export const ID = "volumes";

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const volumesFetch = useStoreActions((actions) => actions.volume.volumesFetch);
  const volumes: Volume[] = useStoreState((state) => state.volume.volumesSearchByTerm(searchTerm));

  usePoller({ poller: volumesFetch });

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader searchTerm={searchTerm} onSearch={onSearchChange} titleIcon={IconNames.DATABASE} rightContent={<VolumeActionsMenu />} />
      <div className="AppScreenContent">
        <HTMLTable interactive condensed striped className="AppDataTable" data-table="volumes">
          <thead>
            <tr>
              <th data-column="Name"><AppLabel iconName={IconNames.DATABASE} text={t("Name")} /></th>
              <th data-column="Driver"><AppLabel iconPath={mdiScrewdriver} text={t("Driver")} /></th>
              <th data-column="Created"><AppLabel iconName={IconNames.CALENDAR} text={t("Created")} /></th>
              <th data-column="Actions">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {volumes.map((volume) => {
              return (
                <tr key={volume.Name}>
                  <td>
                    <AnchorButton
                      className="PodDetailsButton"
                      minimal
                      small
                      href={getVolumeUrl(volume.Name, "inspect")}
                      text={volume.Name}
                      intent={Intent.PRIMARY}
                      icon={IconNames.EYE_OPEN}
                      title={volume.Mountpoint}
                    />
                  </td>
                  <td>{volume.Driver}</td>
                  <td>{(dayjs(volume.CreatedAt) as any).fromNow()}</td>
                  <td>
                    <VolumeActionsMenu withoutCreate volume={volume} />
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
Screen.Title = "Volumes";
Screen.Route = {
  Path: `/screens/${ID}`
};
Screen.Metadata = {
  LeftIcon: IconNames.DATABASE
};
