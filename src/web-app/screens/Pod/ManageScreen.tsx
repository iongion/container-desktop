import { AnchorButton, Code, HTMLTable, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import dayjs from "dayjs";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { Connector, Pod } from "@/env/Types";
import { AppLabel } from "@/web-app/components/AppLabel";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { sortAlphaNum } from "@/web-app/domain/utils";
import { pathTo } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import { resourceEvents } from "@/web-app/stores/resourceEvents";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ItemActionsMenu, ListActionsMenu } from ".";
import "./ManageScreen.css";

export interface ScreenProps extends AppScreenProps {}

export const ID = "pods";

const EMPTY_PODS: Pod[] = [];

const createPodSearchFilter = (searchTerm: string) => {
  const query = searchTerm.toLowerCase();
  return (pod: Pod) => {
    const haystacks = [pod.Name, pod.Id].map((value) => value.toLowerCase());
    return haystacks.some((value) => value.includes(query));
  };
};

export const Screen: AppScreen<ScreenProps> = () => {
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { t } = useTranslation();
  const connectionId = useAppStore((state) => state.currentConnector?.id);
  const podSnapshot = useResourceStore((state) =>
    connectionId ? state.byConnection[connectionId]?.pods.items || EMPTY_PODS : EMPTY_PODS,
  );
  const pods = useMemo(() => {
    const items = searchTerm ? podSnapshot.filter(createPodSearchFilter(searchTerm)) : podSnapshot;
    return [...items].sort((a, b) => sortAlphaNum(a.Name, b.Name));
  }, [podSnapshot, searchTerm]);
  const onReload = useCallback(() => {
    if (connectionId) {
      resourceEvents.refreshMany(connectionId, ["pods", "containers"]);
    }
  }, [connectionId]);

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader
        searchTerm={searchTerm}
        onSearch={onSearchChange}
        titleIcon={IconNames.KEY}
        rightContent={<ListActionsMenu onReload={onReload} />}
      />
      <div className="AppScreenContent">
        {pods.length === 0 ? (
          <NonIdealState
            icon={IconNames.GEOSEARCH}
            title={t("No results")}
            description={<p>{t("There are no pods")}</p>}
          />
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
                const creationDate =
                  typeof pod.Created === "string" ? dayjs(pod.Created) : dayjs(Number(pod.Created) * 1000);
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
  Path: `/screens/${ID}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.CUBE_ADD,
};
Screen.isAvailable = (currentConnector?: Connector) => {
  return currentConnector?.capabilities?.resources.pods === true;
};
