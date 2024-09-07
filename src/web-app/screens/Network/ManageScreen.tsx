import { AnchorButton, Code, HTMLTable, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiDns, mdiEthernet, mdiInfinity, mdiNetwork, mdiScrewdriver } from "@mdi/js";
import * as ReactIcon from "@mdi/react";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";

import { Network } from "@/env/Types";
import { AppLabel } from "@/web-app/components/AppLabel";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { useStoreActions, useStoreState } from "@/web-app/domain/types";
import { usePoller } from "@/web-app/Hooks";
import { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ActionsMenu } from ".";
import "./ManageScreen.css";
import { getNetworkUrl } from "./Navigation";

export interface ScreenProps extends AppScreenProps {}

export const ID = "networks";

export const Screen: AppScreen<ScreenProps> = () => {
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { t } = useTranslation();
  const pending = useStoreState((state) => state.pending);
  const networksFetch = useStoreActions((actions) => actions.network.networksFetch);
  const networks: Network[] = useStoreState((state) => state.network.networksSearchByTerm(searchTerm));

  // Change hydration
  usePoller({ poller: networksFetch });

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader searchTerm={searchTerm} onSearch={onSearchChange} titleIcon={IconNames.HEAT_GRID} rightContent={<ActionsMenu onReload={networksFetch} />} />
      <div className="AppScreenContent">
        {networks.length === 0 ? (
          <NonIdealState icon={IconNames.GEOSEARCH} title={t("No results")} description={<p>{t("There are no networks")}</p>} />
        ) : (
          <HTMLTable interactive compact striped className="AppDataTable" data-table="networks">
            <thead>
              <tr>
                <th data-column="name">
                  <AppLabel iconPath={mdiNetwork} text={t("Name")} />
                </th>
                <th data-column="Id" title={t("First 12 characters")}>
                  <AppLabel iconName={IconNames.BARCODE} text={t("Id")} />
                </th>
                <th data-column="driver">
                  <AppLabel iconPath={mdiScrewdriver} text={t("Driver")} />
                </th>
                <th data-column="network_interface">
                  <AppLabel iconPath={mdiEthernet} text={t("Interface")} />
                </th>
                <th data-column="internal">
                  <AppLabel iconPath={mdiInfinity} text={t("Internal")} />
                </th>
                <th data-column="dns_enabled">
                  <AppLabel iconPath={mdiDns} text={t("DNS")} />
                </th>
                <th data-column="created">
                  <AppLabel iconName={IconNames.CALENDAR} text={t("Created")} />
                </th>
                <th data-column="Actions">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {(networks || []).map((network) => {
                const creationDate = typeof network.created === "string" ? dayjs(network.created) : dayjs(Number(network.created) * 1000);
                return (
                  <tr key={network.id} data-network={network.id}>
                    <td>
                      <AnchorButton className="InspectNetworkButton" minimal small href={getNetworkUrl(network.id, "inspect")} intent={Intent.PRIMARY} icon={IconNames.EYE_OPEN}>
                        <span>{network.name}</span>
                      </AnchorButton>
                    </td>
                    <td>
                      <Code title={network.id}>{network.id?.substring(0, 16)}</Code>
                    </td>
                    <td>{network.driver}</td>
                    <td>
                      <Code>{network.network_interface}</Code>
                    </td>
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
        )}
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
  LeftIcon: <ReactIcon.Icon className="ReactIcon" path={mdiNetwork} size={0.75} />
};
