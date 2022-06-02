import { IconName, IconNames } from "@blueprintjs/icons";

// project
import { AppScreenHeader } from "../../components/AppScreenHeader";
import { pathTo } from "../../Navigator";
import { Machine } from "../../Types.container-app";

import { ActionsMenu } from "./ActionsMenu";

// Screen header

interface ScreenHeaderProps {
  machine: Machine;
  currentScreen: string;
  listRoutePath?: string;
  listRouteIcon?: IconName;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({ machine, currentScreen, listRoutePath, listRouteIcon }) => {
  let currentListRoutePath = listRoutePath;
  if (machine && !currentListRoutePath) {
    currentListRoutePath = pathTo("/screens/machines");
  }
  return (
    <AppScreenHeader
      withBack
      withoutSearch
      listRoutePath={currentListRoutePath}
      listRouteIcon={listRouteIcon || IconNames.GRID_VIEW}
      titleIcon={IconNames.BOX}
      titleText={machine.Name}
      rightContent={<ActionsMenu machine={machine} expand isActive={(input) => input === currentScreen} />}
    />
  );
};
