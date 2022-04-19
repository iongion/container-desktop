// project
import { AppScreenHeader } from "../../components/AppScreenHeader";

import { ActionsMenu } from "./ActionsMenu";

// module

interface ScreenHeaderProps {
  currentScreen: string;
  titleText?: string;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({ currentScreen, titleText }) => {
  return (
    <AppScreenHeader
      titleText={titleText}
      withoutSearch
      rightContent={<ActionsMenu expand isActive={(input) => input === currentScreen} />}
    />
  );
};
