import { useTranslation } from "react-i18next";
import * as ReactIcon from "@mdi/react";
import { mdiLinux, mdiMicrosoftWindows, mdiApple } from "@mdi/js";

import { Platforms } from "../Native";

interface RestrictedToProps {
  platform: Platforms;
}

export const RestrictedTo: React.FC<RestrictedToProps> = ({ platform }) => {
  const { t } = useTranslation();
  const platformsMap: { [key: string]: { icon: string; title: string } } = {
    [Platforms.Linux]: {
      icon: mdiLinux,
      title: t("For Linux")
    },
    [Platforms.Windows]: {
      icon: mdiMicrosoftWindows,
      title: t("Only on Microsoft Windows")
    },
    [Platforms.Mac]: {
      icon: mdiApple,
      title: t("Only on Apple MacOS")
    }
  };
  const info = platformsMap[platform];
  return (
    <div className="EngineRestrictedTo" data-platform={platform}>
      <ReactIcon.Icon path={info.icon} size={0.75} />
      <span className="EngineTitle">{info.title}</span>
    </div>
  );
};
