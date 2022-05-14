import { AnchorButton, HTMLTable, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import dayjs from "dayjs";

// project
import { AppScreenProps, AppScreen } from "../../Types";
import { usePoller } from "../../Hooks";
import { AppScreenHeader } from "../../components/AppScreenHeader";
import { useAppScreenSearch } from "../../components/AppScreenHooks";
import { useStoreActions, useStoreState } from "../../domain/types";

// module
import { ActionsMenu } from ".";

import "./ManageScreen.css";
import { Network } from "../../Types.container-app";
import { getNetworkUrl } from "./Navigation";

export interface ScreenProps extends AppScreenProps {}

export const ID = "networks";

export const Screen: AppScreen<ScreenProps> = () => {
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { t } = useTranslation();
  const networksFetch = useStoreActions((actions) => actions.network.networksFetch);
  const networks: Network[] = useStoreState((state) => state.network.networksSearchByTerm(searchTerm));

  // Change hydration
  usePoller({ poller: networksFetch });

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader
        onSearch={onSearchChange}
        titleIcon={IconNames.HEAT_GRID}
        rightContent={<ActionsMenu />}
      />
      <div className="AppScreenContent">
        <HTMLTable condensed striped className="AppDataTable" data-table="networks">
          <thead>
            <tr>
              <th data-column="name">{t("Name")}</th>
              <th data-column="driver">{t("Driver")}</th>
              <th data-column="network_interface">{t("Interface")}</th>
              <th data-column="internal">{t("Internal")}</th>
              <th data-column="dns_enabled">{t("DNS")}</th>
              <th data-column="created">{t("Created")}</th>
              <th data-column="Actions">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {(networks || []).map((network) => {
              const creationDate = typeof network.created === "string" ? dayjs(network.created) : dayjs(Number(network.created) * 1000);
              return (
                <tr key={network.id} data-network={network.id}>
                  <td>
                    <AnchorButton
                      className="InspectNetworkButton"
                      minimal
                      small
                      href={getNetworkUrl(network.id, "inspect")}
                      intent={Intent.PRIMARY}
                      icon={IconNames.GRAPH}
                    >
                      <strong>{network.name}</strong>
                      <div className="InspectNetworkId" title={network.id}>{network.id?.substring(0, 32)}...</div>
                      </AnchorButton>

                  </td>
                  <td>{network.driver}</td>
                  <td><code>{network.network_interface}</code></td>
                  <td>{network.internal ? t("Yes") : t("No")}</td>
                  <td>{network.dns_enabled ? t("Yes") : t("No")}</td>
                  <td>{creationDate.format("DD MMM YYYY HH:mm")}</td>
                  <td>
                    <ActionsMenu withoutCreate network={network} />
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
Screen.Title = "Networks";
Screen.Route = {
  Path: `/screens/${ID}`
};
Screen.Metadata = {
  LeftIcon: IconNames.GRAPH
};
