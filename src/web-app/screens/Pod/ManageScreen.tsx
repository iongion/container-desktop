import { AnchorButton, Code, HTMLTable, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";

import { Connector, Pod } from "@/env/Types";
import { AppLabel } from "@/web-app/components/AppLabel";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { useStoreActions, useStoreState } from "@/web-app/domain/types";
import { usePoller } from "@/web-app/Hooks";
import { pathTo } from "@/web-app/Navigator";
import { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ItemActionsMenu, ListActionsMenu } from ".";
import "./ManageScreen.css";

export interface ScreenProps extends AppScreenProps {}

export const ID = "pods";

export const Screen: AppScreen<ScreenProps> = () => {
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { t } = useTranslation();
  const pending = useStoreState((state) => state.pending);
  const podsFetch = useStoreActions((actions) => actions.pod.podsFetch);
  const pods: Pod[] = useStoreState((state) => state.pod.podsSearchByTerm(searchTerm));

  // Change hydration
  usePoller({ poller: podsFetch });

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader searchTerm={searchTerm} onSearch={onSearchChange} titleIcon={IconNames.KEY} rightContent={<ListActionsMenu onReload={podsFetch} />} />
      <div className="AppScreenContent">
        {pods.length === 0 ? (
          <NonIdealState icon={IconNames.GEOSEARCH} title={t("No results")} description={<p>{t("There are no pods")}</p>} />
        ) : (
          <HTMLTable interactive compact striped className="AppDataTable" data-table="pods">
            <thead>
              <tr>
                <th data-column="Name">
                  <AppLabel iconName={IconNames.CUBE} text={t("Name")} />
                </th>
                <th data-column="Containers" title={t("Count of containers using the pod")}>
                  <AppLabel iconName={IconNames.BOX} />
                </th>
                <th data-column="State">{t("State")}</th>
                <th data-column="Id" title={t("First 12 characters")}>
                  <AppLabel iconName={IconNames.BARCODE} text={t("Id")} />
                </th>
                <th data-column="Created">
                  <AppLabel iconName={IconNames.CALENDAR} text={t("Created")} />
                </th>
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
                    icon={IconNames.LIST_COLUMNS}
                    title={t("Pod processes")}
                  />
                );
                const creationDate = typeof pod.Created === "string" ? dayjs(pod.Created) : dayjs(Number(pod.Created) * 1000);
                return (
                  <tr key={pod.Id} data-pod={pod.Id} data-state={pod.Status}>
                    <td>{podDetailsButton}</td>
                    <td>{pod.Containers.length}</td>
                    <td>
                      <span className="PodState" data-state={pod.Status}>
                        {pod.Status}
                      </span>
                    </td>
                    <td>
                      <Code>{pod.Id.substring(0, 12)}</Code>
                    </td>
                    <td>{creationDate.format("DD MMM YYYY HH:mm")}</td>
                    <td>
                      <ItemActionsMenu pod={pod} />
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
Screen.Title = "Pods";
Screen.Route = {
  Path: `/screens/${ID}`
};
Screen.Metadata = {
  LeftIcon: IconNames.CUBE_ADD
};
Screen.isAvailable = (currentConnector?: Connector) => {
  return !(currentConnector?.engine || "").startsWith("docker");
};
