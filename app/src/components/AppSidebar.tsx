import { ButtonGroup, Alignment, AnchorButton } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

import { AppSidebarFooter } from "./AppSidebarFooter";

import { AppScreen } from "../Types";
import { pathTo } from "../Navigator";

// locals
import "./AppSidebar.css";

interface AppSidebarProps {
  screens: AppScreen<any>[];
  currentScreen: AppScreen<any>;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({ screens, currentScreen }) => {
  const { t } = useTranslation();
  const sidebarScreens = screens.filter((screen) => !screen.Metadata?.ExcludeFromSidebar);
  return (
    <div className="AppSidebar">
      <div className="AppSidebarActions">
        <ButtonGroup vertical>
          {sidebarScreens.map((Screen) => {
            return (
              <AnchorButton
                active={currentScreen?.ID === Screen.ID}
                href={pathTo(Screen.Route.Path)}
                text={t(Screen.Title)}
                alignText={Alignment.LEFT}
                minimal
                key={Screen.ID}
                data-screen={Screen.ID}
                icon={Screen.Metadata?.LeftIcon}
                rightIcon={Screen.Metadata?.RightIcon}
              />
            );
          })}
        </ButtonGroup>
      </div>
      <div className="AppSidebarContent"></div>
      <AppSidebarFooter />
    </div>
  );
};
