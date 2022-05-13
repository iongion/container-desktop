// project
import { AppScreenHeader } from "../../components/AppScreenHeader";

import { ActionsMenu } from "./ActionsMenu";

// module

interface ScreenHeaderProps {
  currentScreen: string;
  titleText?: string;
  children?: any;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({ currentScreen, titleText, children }) => {
  return (
    <AppScreenHeader
      titleText={titleText}
      withoutSearch
      rightContent={<ActionsMenu expand isActive={(input) => input === currentScreen} />}
    >
      {children}
    </AppScreenHeader>
  );
};
