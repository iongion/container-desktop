import { type IconName, IconNames } from "@blueprintjs/icons";

import type { PodmanMachine } from "@/env/Types";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { pathTo } from "@/web-app/Navigator";

import { ActionsMenu } from "./ActionsMenu";

interface ScreenHeaderProps {
  machine: PodmanMachine;
  currentScreen: string;
  listRoutePath?: string;
  listRouteIcon?: IconName;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  machine,
  currentScreen,
  listRoutePath,
  listRouteIcon,
}: ScreenHeaderProps) => {
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
