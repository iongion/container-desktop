import { type IconName, IconNames } from "@blueprintjs/icons";

import type { PodmanMachine, PodmanMachineInspect } from "@/env/Types";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { pathTo } from "@/web-app/Navigator";

import { ActionsMenu } from "./ActionsMenu";
import { getMachineCrumbs } from "./Navigation";

interface ScreenHeaderProps {
  machine: PodmanMachine | PodmanMachineInspect;
  connectionId?: string;
  currentScreen: string;
  listRoutePath?: string;
  listRouteIcon?: IconName;
  onReload?: () => void;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  machine,
  connectionId,
  currentScreen,
  listRoutePath,
  listRouteIcon,
  onReload,
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
      breadcrumbs={getMachineCrumbs(machine.Name, connectionId)}
      rightContent={
        <ActionsMenu
          machine={machine}
          connectionId={connectionId}
          expand
          isActive={(input) => input === currentScreen}
          onReload={onReload}
        />
      }
    />
  );
};
