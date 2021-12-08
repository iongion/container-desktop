import { HTMLTable, Icon } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";

// project
import { AppScreen, Volume } from "../../Types";
import { usePoller } from "../../Hooks";
import { AppScreenHeader } from "../../components/AppScreenHeader";
import { useAppScreenSearch } from "../../components/AppScreenHooks";
import { useStoreActions, useStoreState } from "../../domain/types";

// module
import { VolumeActionsMenu } from ".";

import "./ManageScreen.css";

export const ID = "volumes";

interface ScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const volumesFetch = useStoreActions((actions) => actions.volume.volumesFetch);
  const volumes: Volume[] = useStoreState((state) => state.volume.volumesSearchByTerm(searchTerm));

  usePoller({ poller: volumesFetch });

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader onSearch={onSearchChange} titleIcon={IconNames.DATABASE} rightContent={<VolumeActionsMenu />} />
      <div className="AppScreenContent">
        <HTMLTable condensed striped className="AppDataTable" data-table="volumes">
          <thead>
            <tr>
              <th data-column="Name">{t("Name")}</th>
              <th data-column="Driver">{t("Driver")}</th>
              <th data-column="Created">{t("Created")}</th>
              <th data-column="Actions">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {volumes.map((volume) => {
              return (
                <tr key={volume.Name}>
                  <td>
                    <span className="VolumeTooltip" title={volume.Mountpoint}>
                      <Icon icon={IconNames.DATABASE} />
                    </span>
                    &nbsp;
                    {volume.Name}
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
