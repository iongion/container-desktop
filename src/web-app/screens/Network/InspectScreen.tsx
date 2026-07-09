import { IconNames } from "@blueprintjs/icons";
import i18n from "@/i18n";
import { ResourceInspectTabs } from "@/web-app/components/ResourceInspectTabs";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useRouteParams, useRouteSearch } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ScreenHeader } from ".";
import "./InspectScreen.css";
import { buildNetworkSummary } from "./inspectSummary";
import { useNetwork } from "./queries";

export const ID = "network.inspect";
export const Title = i18n.t("Network Inspect");

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { name } = useRouteParams<{ name: string }>();
  const { connId } = useRouteSearch<{ connId?: string }>();
  const primaryConnectionId = useAppStore((state) => state.currentConnector?.id || "");
  const connectionId = connId || primaryConnectionId;
  const networkQuery = useNetwork(connectionId, name);
  const network = networkQuery.data;
  if (!network) {
    return <ScreenLoader screen={ID} pending={networkQuery.isLoading || networkQuery.isFetching} />;
  }
  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader network={network} currentScreen={ID} />
      <ResourceInspectTabs
        dataScreen={ID}
        summaryRows={buildNetworkSummary(network)}
        summaryTable="network.inspect-summary"
        rawValue={JSON.stringify(network, null, 2)}
      />
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: "/screens/network/$name/inspect",
};
Screen.Metadata = {
  LeftIcon: IconNames.GRAPH,
  ExcludeFromSidebar: true,
};
