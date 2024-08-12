import { IconName, IconNames } from "@blueprintjs/icons";

// project
import { AppScreenHeader } from "../../components/AppScreenHeader";
import { pathTo } from "../../Navigator";
import { Container } from "../../Types.container-app";

import { ActionsMenu } from "./ActionsMenu";

// Screen header

interface ScreenHeaderProps {
  container: Container;
  currentScreen: string;
  listRoutePath?: string;
  listRouteIcon?: IconName;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  container,
  currentScreen,
  listRoutePath,
  listRouteIcon
}) => {
  let currentListRoutePath = listRoutePath;
  if (container && !currentListRoutePath) {
    currentListRoutePath = pathTo("/screens/containers");
  }
  return (
    <AppScreenHeader
      withBack
      withoutSearch
      listRoutePath={currentListRoutePath}
      listRouteIcon={listRouteIcon || IconNames.GRID_VIEW}
      titleIcon={IconNames.BOX}
      titleText={container.Name || container.Id || ""}
      rightContent={<ActionsMenu container={container} expand isActive={(input) => input === currentScreen} />}
    />
  );
};
