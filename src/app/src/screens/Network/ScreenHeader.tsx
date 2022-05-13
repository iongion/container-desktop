import { IconName, IconNames } from "@blueprintjs/icons";

// project
import { AppScreenHeader } from "../../components/AppScreenHeader";
import { pathTo } from "../../Navigator";
import { Network } from "../../Types.container-app";

import { ActionsMenu } from "./ActionsMenu";

// Screen header

interface ScreenHeaderProps {
  network: Network;
  currentScreen: string;
  listRoutePath?: string;
  listRouteIcon?: IconName;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({ network, currentScreen, listRoutePath, listRouteIcon }) => {
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
      titleIcon={IconNames.BOX}
      titleText={network.name || network.id || ""}
      rightContent={<ActionsMenu network={network} expand isActive={(input) => input === currentScreen} />}
    />
  );
};
