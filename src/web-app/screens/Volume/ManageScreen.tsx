import { AnchorButton, HTMLTable, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiScrewdriver } from "@mdi/js";
import dayjs from "dayjs";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { Volume } from "@/env/Types";
import { AppLabel } from "@/web-app/components/AppLabel";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { sortAlphaNum } from "@/web-app/domain/utils";
import { useAppStore } from "@/web-app/stores/appStore";
import { resourceEvents } from "@/web-app/stores/resourceEvents";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { VolumeActionsMenu } from ".";
import { getVolumeUrl } from "./Navigation";
import "./ManageScreen.css";

export const ID = "volumes";

export interface ScreenProps extends AppScreenProps {}

const EMPTY_VOLUMES: Volume[] = [];

const createVolumeSearchFilter = (searchTerm: string) => {
  const query = searchTerm.toLowerCase();
  return (volume: Volume) => {
    const haystacks = [volume.Name, volume.Scope || ""].map((value) => value.toLowerCase());
    return haystacks.some((value) => value.includes(query));
  };
};

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const connectionId = useAppStore((state) => state.currentConnector?.id);
  const volumeSnapshot = useResourceStore((state) =>
    connectionId ? state.byConnection[connectionId]?.volumes.items || EMPTY_VOLUMES : EMPTY_VOLUMES,
  );
  const volumes = useMemo(() => {
    const items = searchTerm ? volumeSnapshot.filter(createVolumeSearchFilter(searchTerm)) : volumeSnapshot;
    return [...items].sort((a, b) => sortAlphaNum(a.Name, b.Name));
  }, [volumeSnapshot, searchTerm]);
  const onReload = useCallback(() => {
    if (connectionId) {
      resourceEvents.refresh(connectionId, "volumes");
    }
  }, [connectionId]);

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader
        searchTerm={searchTerm}
        onSearch={onSearchChange}
        titleIcon={IconNames.DATABASE}
        rightContent={<VolumeActionsMenu onReload={onReload} />}
      />
      <div className="AppScreenContent">
        {volumes.length === 0 ? (
          <NonIdealState
            icon={IconNames.GEOSEARCH}
            title={t("No results")}
            description={<p>{t("There are no volumes")}</p>}
          />
        ) : (
          <HTMLTable interactive compact striped className="AppDataTable" data-table="volumes">
            <thead>
              <tr>
                <th data-column="Name">
                  <AppLabel iconName={IconNames.DATABASE} text={t("Name")} />
                </th>
                <th data-column="Driver">
                  <AppLabel iconPath={mdiScrewdriver} text={t("Driver")} />
                </th>
                <th data-column="Created">
                  <AppLabel iconName={IconNames.CALENDAR} text={t("Created")} />
                </th>
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
        )}
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Volumes";
Screen.Route = {
  Path: `/screens/${ID}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.DATABASE,
};
