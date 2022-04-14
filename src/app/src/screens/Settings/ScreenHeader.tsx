// project
import { AppScreenHeader } from "../../components/AppScreenHeader";

import { ActionsMenu } from "./ActionsMenu";

// module

interface ScreenHeaderProps {
  currentScreen: string;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({ currentScreen }) => {
  return (
    <AppScreenHeader
      withoutSearch
      rightContent={<ActionsMenu expand isActive={(input) => input === currentScreen} />}
    />
  );
};
