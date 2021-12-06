
import { IconNames } from "@blueprintjs/icons";

import { AppScreenHeader } from "../AppScreenHeader";
import { ContainerImage } from "../../Types";

import { ActionsMenu } from "./ActionsMenu";

interface ScreenHeaderProps {
  image: ContainerImage;
  currentScreen: string;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({ image, currentScreen }) => {
  return (
    <AppScreenHeader
      withBack
      withoutSearch
      titleIcon={IconNames.BOX}
      titleText={image.Id || ""}
      rightContent={<ActionsMenu image={image} withoutStart expand isActive={(input) => input === currentScreen} />}
    />
  );
};
