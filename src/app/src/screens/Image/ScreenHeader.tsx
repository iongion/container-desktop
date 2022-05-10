import { IconName, IconNames } from "@blueprintjs/icons";

// project
import { ContainerImage } from "../../Types";
import { AppScreenHeader } from "../../components/AppScreenHeader";
import { pathTo } from "../../Navigator";

import { ActionsMenu } from "./ActionsMenu";

// Screen header

interface ScreenHeaderProps {
  image: ContainerImage;
  currentScreen: string;
  listRoutePath?: string;
  listRouteIcon?: IconName;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({ image, currentScreen, listRoutePath, listRouteIcon }) => {
  let currentListRoutePath = listRoutePath;
  if (image && !currentListRoutePath) {
    currentListRoutePath = pathTo("/screens/images");
  }
  return (
    <AppScreenHeader
      withBack
      withoutSearch
      listRoutePath={currentListRoutePath}
      listRouteIcon={listRouteIcon || IconNames.GRID_VIEW}
      titleIcon={IconNames.BOX}
      titleText={image.Name || image.Id || ""}
      rightContent={<ActionsMenu image={image} expand isActive={(input) => input === currentScreen} />}
    />
  );
};
