import { IconName, IconNames } from "@blueprintjs/icons";

// project
import { Pod } from "../../Types";
import { AppScreenHeader } from "../../components/AppScreenHeader";
import { pathTo } from "../../Navigator";

import { ItemActionsMenu } from "./ActionsMenu";

// Screen header

interface ScreenHeaderProps {
  pod?: Pod;
  currentScreen: string;
  listRoutePath?: string;
  listRouteIcon?: IconName;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({ pod, currentScreen, listRoutePath, listRouteIcon }) => {
  let currentListRoutePath = listRoutePath;
  if (pod && !currentListRoutePath) {
    currentListRoutePath = pathTo("/screens/pods");
  }
  return (
    <AppScreenHeader
      withBack
      withoutSearch
      listRoutePath={currentListRoutePath}
      listRouteIcon={listRouteIcon || IconNames.GRID_VIEW}
      titleIcon={IconNames.CUBE_ADD}
      titleText={pod?.Name || pod?.Id || ""}
      rightContent={pod ? <ItemActionsMenu pod={pod} expand isActive={(input) => input === currentScreen} /> : undefined}
    />
  );
};
