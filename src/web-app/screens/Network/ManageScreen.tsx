import { AnchorButton, Code, HTMLTable, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiDns, mdiEthernet, mdiInfinity, mdiNetwork, mdiScrewdriver } from "@mdi/js";
import * as ReactIcon from "@mdi/react";
import dayjs from "dayjs";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { Network } from "@/env/Types";
import { AppLabel } from "@/web-app/components/AppLabel";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { SortableColumnHeader } from "@/web-app/components/SortableColumnHeader";
import { sortAlphaNum } from "@/web-app/domain/utils";
import { useColumnSort } from "@/web-app/hooks/useColumnSort";
import { useAppStore } from "@/web-app/stores/appStore";
import { resourceEvents } from "@/web-app/stores/resourceEvents";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { type SortSelectors, sortByField } from "@/web-app/utils/comparators";

import { ActionsMenu } from ".";
import "./ManageScreen.css";
import { getNetworkUrl } from "./Navigation";

export interface ScreenProps extends AppScreenProps {}

export const ID = "networks";

const EMPTY_NETWORKS: Network[] = [];

const createNetworkSearchFilter = (searchTerm: string) => {
  const query = searchTerm.toLowerCase();
  return (network: Network) => {
    const haystacks = [network.name || "", network.id || ""].map((value) => value.toLowerCase());
    return haystacks.some((value) => value.includes(query));
  };
};

const networkSortSelectors: SortSelectors<Network> = {
  name: (network) => network.name,
  id: (network) => network.id,
  driver: (network) => network.driver,
  interface: (network) => network.network_interface,
  internal: (network) => network.internal,
  dns: (network) => network.dns_enabled,
  created: (network) =>
    typeof network.created === "string" ? Date.parse(network.created) : Number(network.created) * 1000,
};

export const Screen: AppScreen<ScreenProps> = () => {
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { t } = useTranslation();
  const currentConnector = useAppStore((state) => state.currentConnector);
  const connectionId = currentConnector?.id;
  const { clientSort, getColumnSortDirection, toggleColumnSort } = useColumnSort(
    ID,
    currentConnector?.capabilities?.sort,
  );
  const networkSnapshot = useResourceStore((state) =>
    connectionId ? state.byConnection[connectionId]?.networks.items || EMPTY_NETWORKS : EMPTY_NETWORKS,
  );
  const networks = useMemo(() => {
    const items = searchTerm ? networkSnapshot.filter(createNetworkSearchFilter(searchTerm)) : networkSnapshot;
    return clientSort
      ? sortByField(items, clientSort, networkSortSelectors)
      : [...items].sort((a, b) => sortAlphaNum(a.name, b.name));
  }, [clientSort, networkSnapshot, searchTerm]);
  const onReload = useCallback(() => {
    if (connectionId) {
      resourceEvents.refresh(connectionId, "networks");
    }
  }, [connectionId]);

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader
        searchTerm={searchTerm}
        onSearch={onSearchChange}
        titleIcon={IconNames.HEAT_GRID}
        rightContent={<ActionsMenu onReload={onReload} />}
      />
      <div className="AppScreenContent">
        {networks.length === 0 ? (
          <NonIdealState
            icon={IconNames.GEOSEARCH}
            title={t("No results")}
            description={<p>{t("There are no networks")}</p>}
          />
        ) : (
          <HTMLTable interactive compact striped className="AppDataTable" data-table="networks">
            <thead>
              <tr>
                <SortableColumnHeader field="name" direction={getColumnSortDirection("name")} onSort={toggleColumnSort}>
                  <AppLabel iconPath={mdiNetwork} text={t("Name")} />
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="id"
                  direction={getColumnSortDirection("id")}
                  onSort={toggleColumnSort}
                  title={t("First 12 characters")}
                >
                  <AppLabel iconName={IconNames.BARCODE} text={t("Id")} />
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="driver"
                  direction={getColumnSortDirection("driver")}
                  onSort={toggleColumnSort}
                >
                  <AppLabel iconPath={mdiScrewdriver} text={t("Driver")} />
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="interface"
                  direction={getColumnSortDirection("interface")}
                  onSort={toggleColumnSort}
                >
                  <AppLabel iconPath={mdiEthernet} text={t("Interface")} />
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="internal"
                  direction={getColumnSortDirection("internal")}
                  onSort={toggleColumnSort}
                >
                  <AppLabel iconPath={mdiInfinity} text={t("Internal")} />
                </SortableColumnHeader>
                <SortableColumnHeader field="dns" direction={getColumnSortDirection("dns")} onSort={toggleColumnSort}>
                  <AppLabel iconPath={mdiDns} text={t("DNS")} />
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="created"
                  direction={getColumnSortDirection("created")}
                  onSort={toggleColumnSort}
                >
                  <AppLabel iconName={IconNames.CALENDAR} text={t("Created")} />
                </SortableColumnHeader>
                <th data-column="Actions">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {(networks || []).map((network) => {
                const creationDate =
                  typeof network.created === "string" ? dayjs(network.created) : dayjs(Number(network.created) * 1000);
                return (
                  <tr key={network.id} data-network={network.id}>
                    <td>
                      <AnchorButton
                        className="InspectNetworkButton"
                        minimal
                        small
                        href={getNetworkUrl(network.id, "inspect")}
                        intent={Intent.PRIMARY}
                        icon={IconNames.EYE_OPEN}
                      >
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
  Path: `/screens/${ID}`,
};
Screen.Metadata = {
  LeftIcon: <ReactIcon.Icon className="ReactIcon" path={mdiNetwork} size={0.75} />,
};
