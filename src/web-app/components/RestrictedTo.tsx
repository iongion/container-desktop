import { mdiApple, mdiLinux, mdiMicrosoftWindows } from "@mdi/js";
import * as ReactIcon from "@mdi/react";
import { useTranslation } from "react-i18next";

import { ContainerEngine } from "@/env/Types";
import "./RestrictedTo.css";

interface RestrictedToProps {
  engine: ContainerEngine;
  withTitle?: boolean;
}

export const RestrictedTo: React.FC<RestrictedToProps> = ({ engine, withTitle }: RestrictedToProps) => {
  const { t } = useTranslation();
  const platformsMap: { [key: string]: { icon?: string; title: string; ignore?: boolean } } = {
    // Podman
    [ContainerEngine.PODMAN_NATIVE]: {
      icon: mdiLinux,
      title: t("Only on Linux"),
      ignore: false
    },
    [ContainerEngine.PODMAN_VIRTUALIZED_WSL]: {
      icon: mdiMicrosoftWindows,
      title: t("Only on Microsoft Windows"),
      ignore: false
    },
    [ContainerEngine.PODMAN_VIRTUALIZED_LIMA]: {
      icon: mdiApple,
      title: t("Only on Apple MacOS"),
      ignore: false
    },
    [ContainerEngine.PODMAN_VIRTUALIZED_VENDOR]: {
      icon: undefined,
      title: "",
      ignore: true
    },
    [ContainerEngine.PODMAN_REMOTE]: {
      icon: undefined,
      title: "",
      ignore: true
    },
    // Docker
    [ContainerEngine.DOCKER_NATIVE]: {
      icon: mdiLinux,
      title: t("Only on Linux"),
      ignore: false
    },
    [ContainerEngine.DOCKER_VIRTUALIZED_WSL]: {
      icon: mdiMicrosoftWindows,
      title: t("Only on Microsoft Windows"),
      ignore: false
    },
    [ContainerEngine.DOCKER_VIRTUALIZED_LIMA]: {
      icon: mdiApple,
      title: t("Only on Apple MacOS"),
      ignore: false
    },
    [ContainerEngine.DOCKER_VIRTUALIZED_VENDOR]: {
      icon: undefined,
      title: "",
      ignore: true
    },
    [ContainerEngine.DOCKER_REMOTE]: {
      icon: undefined,
      title: "",
      ignore: true
    }
  };
  const info = platformsMap[engine];
  return !info || info.ignore ? null : (
    <div className="RestrictedTo" data-engine={engine} title={info.title}>
      {info.icon && <ReactIcon.Icon path={info.icon} size={0.75} />}
      {withTitle && <span className="RestrictedToEngineTitle">{info.title}</span>}
    </div>
  );
};
