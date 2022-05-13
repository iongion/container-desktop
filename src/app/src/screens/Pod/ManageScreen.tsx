import { AnchorButton, HTMLTable, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import dayjs from "dayjs";

// project
import { ApplicationDescriptor } from "../../Types.container-app";

// module

import { Pod } from "../../Types.container-app";
import { AppScreenProps, AppScreen } from "../../Types";
import { usePoller } from "../../Hooks";
import { AppScreenHeader } from "../../components/AppScreenHeader";
import { useAppScreenSearch } from "../../components/AppScreenHooks";
import { pathTo } from "../../Navigator";
import { useStoreActions, useStoreState } from "../../domain/types";

import { ListActionsMenu, ItemActionsMenu } from ".";

import "./ManageScreen.css";

export interface ScreenProps extends AppScreenProps {}

export const ID = "pods";

export const Screen: AppScreen<ScreenProps> = () => {
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { t } = useTranslation();
  const podsFetch = useStoreActions((actions) => actions.pod.podsFetch);
  const pods: Pod[] = useStoreState((state) => state.pod.podsSearchByTerm(searchTerm));

  // Change hydration
  usePoller({ poller: podsFetch });

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader onSearch={onSearchChange} titleIcon={IconNames.KEY} rightContent={<ListActionsMenu />} />
      <div className="AppScreenContent">
        <HTMLTable condensed striped className="AppDataTable" data-table="pods">
          <thead>
            <tr>
              <th data-column="Name">{t("Name")}</th>
              <th data-column="Containers">{t("Containers")}</th>
              <th data-column="State">{t("State")}</th>
              <th data-column="Digest">{t("Digest")}</th>
              <th data-column="Created">{t("Created")}</th>
              <th data-column="Actions">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {pods.map((pod) => {
              const podDetailsButton = (
                <AnchorButton
                  className="PodDetailsButton"
                  minimal
                  small
                  href={pathTo(`/screens/pod/${encodeURIComponent(pod.Id)}/processes`)}
                  text={pod.Name}
                  intent={Intent.PRIMARY}
                  icon={IconNames.CUBE_ADD}
                  title={t("Pod processes")}
                />
              );
              const creationDate = typeof pod.Created === "string" ? dayjs(pod.Created) : dayjs(Number(pod.Created) * 1000);
              return (
                <tr key={pod.Id} data-pod={pod.Id} data-state={pod.Status}>
                  <td>
                    {podDetailsButton}
                  </td>
                  <td>
                    {pod.Containers.length}
                  </td>
                  <td>
                    <span className="PodState" data-state={pod.Status}>{pod.Status}</span>
                  </td>
                  <td>{pod.Id.substring(0, 12)}</td>
                  <td>{creationDate.format("DD MMM YYYY HH:mm")}</td>
                  <td>
                    <ItemActionsMenu pod={pod} />
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
Screen.Title = "Pods";
Screen.Route = {
  Path: `/screens/${ID}`
};
Screen.Metadata = {
  LeftIcon: IconNames.CUBE_ADD
};
Screen.isAvailable = (context: ApplicationDescriptor) => {
  return !context.currentConnector.engine.startsWith("docker");
}
