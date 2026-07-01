import { type IconName, IconNames } from "@blueprintjs/icons";

import type { Network } from "@/env/Types";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { pathTo, useRouteSearch } from "@/web-app/Navigator";

import { ActionsMenu } from "./ActionsMenu";
import { getNetworkCrumbs } from "./Navigation";

// Screen header

interface ScreenHeaderProps {
  network: Network;
  currentScreen: string;
  listRoutePath?: string;
  listRouteIcon?: IconName;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  network,
  currentScreen,
  listRoutePath,
  listRouteIcon,
}: ScreenHeaderProps) => {
  // Keep the owning connection while moving between this resource's detail views (ids collide across engines).
  const { connId } = useRouteSearch<{ connId?: string }>();
  let currentListRoutePath = listRoutePath;
  if (network && !currentListRoutePath) {
    currentListRoutePath = pathTo("/screens/networks");
  }
  return (
    <AppScreenHeader
      withBack
      withoutSearch
      listRoutePath={currentListRoutePath}
      listRouteIcon={listRouteIcon || IconNames.GRID_VIEW}
      titleIcon={IconNames.GRAPH}
      titleText={network.name || network.id || ""}
      breadcrumbs={getNetworkCrumbs(network.name || network.id || "", connId)}
      rightContent={<ActionsMenu withoutCreate network={network} />}
    />
  );
};
