import { IconNames } from "@blueprintjs/icons";

// project
import { Container } from "../../Types";
import { AppScreenHeader } from "../AppScreenHeader";

import { ActionsMenu } from "./ActionsMenu";

// Screen header

interface ScreenHeaderProps {
  container: Container;
  currentScreen: string;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({ container, currentScreen }) => {
  return (
    <AppScreenHeader
      withBack
      withoutSearch
      titleIcon={IconNames.BOX}
      titleText={container.Name || container.Id || ""}
      rightContent={<ActionsMenu container={container} expand isActive={(input) => input === currentScreen} />}
    />
  );
};
