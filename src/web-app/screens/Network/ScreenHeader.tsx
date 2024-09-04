import { IconName, IconNames } from "@blueprintjs/icons";

import { Network } from "@/env/Types";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { pathTo } from "@/web-app/Navigator";

import { ActionsMenu } from "./ActionsMenu";

// Screen header

interface ScreenHeaderProps {
  network: Network;
  currentScreen: string;
  listRoutePath?: string;
  listRouteIcon?: IconName;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({ network, currentScreen, listRoutePath, listRouteIcon }: ScreenHeaderProps) => {
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
      rightContent={<ActionsMenu withoutCreate network={network} />}
    />
  );
};
