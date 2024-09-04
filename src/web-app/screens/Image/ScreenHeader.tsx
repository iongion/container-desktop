import { IconName, IconNames } from "@blueprintjs/icons";

import { ContainerImage } from "@/env/Types";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { pathTo } from "@/web-app/Navigator";

import { ActionsMenu } from "./ActionsMenu";

// Screen header

interface ScreenHeaderProps {
  image: ContainerImage;
  currentScreen: string;
  listRoutePath?: string;
  listRouteIcon?: IconName;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({ image, currentScreen, listRoutePath, listRouteIcon }: ScreenHeaderProps) => {
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
