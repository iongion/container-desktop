import { useTranslation } from "react-i18next";
import * as ReactIcon from "@mdi/react";
import { mdiLinux, mdiMicrosoftWindows, mdiApple } from "@mdi/js";

import { ContainerEngine } from "../Types";

import "./RestrictedTo.css";

interface RestrictedToProps {
  engine: ContainerEngine;
}

export const RestrictedTo: React.FC<RestrictedToProps> = ({ engine }) => {
  const { t } = useTranslation();
  const platformsMap: { [key: string]: { icon?: string; title: string; ignore?: boolean } } = {
    [ContainerEngine.NATIVE]: {
      icon: mdiLinux,
      title: t("Only on Linux"),
      ignore: false
    },
    [ContainerEngine.SUBSYSTEM_WSL]: {
      icon: mdiMicrosoftWindows,
      title: t("Only on Microsoft Windows"),
      ignore: false
    },
    [ContainerEngine.SUBSYSTEM_LIMA]: {
      icon: mdiApple,
      title: t("Only on Apple MacOS"),
      ignore: false
    },
    [ContainerEngine.VIRTUALIZED]: {
      icon: undefined,
      title: "",
      ignore: true
    },
    [ContainerEngine.REMOTE]: {
      icon: undefined,
      title: "",
      ignore: true
    }
  };
  const info = platformsMap[engine];
  return info.ignore ? null : (
    <div className="RestrictedTo" data-platform={engine}>
      {info.icon && <ReactIcon.Icon path={info.icon} size={0.75} />}
      <span className="RestrictedToEngineTitle">{info.title}</span>
    </div>
  );
};
