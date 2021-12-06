import { useCallback, useEffect, useState } from "react";
import { HTMLTable, Icon } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";

import { AppScreen } from "../../Types";
import { useStoreActions, useStoreState } from "../../Domain";
import { usePoller } from "../../Hooks";
import { AppScreenHeader } from "../AppScreenHeader";

import "./ManageScreen.css";

import { VolumeActionsMenu } from ".";

export const ID = "volumes";

interface ScreenProps {}
export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const volumesFetch = useStoreActions((actions) => actions.volumesFetch);
  const volumes = useStoreState((state) => state.volumes);
  const [items, setItems] = useState(volumes);
  const onSearchChange = useCallback(
    (e) => {
      const needle = e.currentTarget.value.toLowerCase();
      const filtered = volumes.filter((it) => {
        const haystacks = [it.Name, it.Mountpoint, it.Scope].map((t) => t.toLowerCase());
        const matching = haystacks.find((it) => it.includes(needle));
        return !!matching;
      });
      setItems(filtered);
    },
    [volumes]
  );

  // Change hydration
  useEffect(() => {
    setItems(volumes);
  }, [volumes]);

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
            {items.map((volume) => {
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
