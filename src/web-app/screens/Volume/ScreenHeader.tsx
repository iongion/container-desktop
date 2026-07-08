import { AnchorButton, ButtonGroup } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { getVolumesUrl } from "./Navigation";

import "./ScreenHeader.css";

interface ScreenHeaderSectionsTabBarProps {
  isActive?: (screen: string) => boolean;
}

// The Volumes navbar tab navigator — mirrors screens/Connections/ScreenHeader.tsx (one shared section tab bar),
// two sections: the Volumes list and the Mounts inspector. Dropped into each screen's AppScreenHeader.
export const ScreenHeaderSectionsTabBar: React.FC<ScreenHeaderSectionsTabBarProps> = ({
  isActive,
}: ScreenHeaderSectionsTabBarProps) => {
  const { t } = useTranslation();
  return (
    <ButtonGroup className="VolumeHeaderTabs">
      <AnchorButton
        variant="minimal"
        active={isActive ? isActive("volumes.manage") : false}
        icon={IconNames.DATABASE}
        text={t("Volumes")}
        href={getVolumesUrl("manage")}
      />
      <AnchorButton
        variant="minimal"
        active={isActive ? isActive("volumes.mounts") : false}
        icon={IconNames.FOLDER_SHARED}
        text={t("Mounts")}
        href={getVolumesUrl("mounts")}
      />
    </ButtonGroup>
  );
};
