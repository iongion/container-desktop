import { IconNames } from "@blueprintjs/icons";

// project
import { Pod } from "../../Types";
import { AppScreenHeader } from "../../components/AppScreenHeader";

import { ItemActionsMenu } from "./ActionsMenu";

// Screen header

interface ScreenHeaderProps {
  pod: Pod;
  currentScreen: string;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({ pod, currentScreen }) => {
  return (
    <AppScreenHeader
      withBack
      withoutSearch
      titleIcon={IconNames.BOX}
      titleText={pod.Name || pod.Id || ""}
      rightContent={<ItemActionsMenu pod={pod} expand isActive={(input) => input === currentScreen} />}
    />
  );
};
