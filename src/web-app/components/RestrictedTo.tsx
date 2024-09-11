import { mdiApple, mdiLinux, mdiMicrosoftWindows } from "@mdi/js";
import * as ReactIcon from "@mdi/react";
import { useTranslation } from "react-i18next";

import { ContainerEngineHost } from "@/env/Types";
import "./RestrictedTo.css";

interface RestrictedToProps {
  host: ContainerEngineHost;
  withTitle?: boolean;
}

export const RestrictedTo: React.FC<RestrictedToProps> = ({ host, withTitle }: RestrictedToProps) => {
  const { t } = useTranslation();
  const platformsMap: { [key: string]: { icon?: string; title: string; ignore?: boolean } } = {
    // Podman
    [ContainerEngineHost.PODMAN_NATIVE]: {
      icon: mdiLinux,
      title: t("Only on Linux"),
      ignore: false
    },
    [ContainerEngineHost.PODMAN_VIRTUALIZED_WSL]: {
      icon: mdiMicrosoftWindows,
      title: t("Only on Microsoft Windows"),
      ignore: false
    },
    [ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA]: {
      icon: mdiApple,
      title: t("Only on Apple MacOS"),
      ignore: false
    },
    [ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR]: {
      icon: undefined,
      title: "",
      ignore: true
    },
    [ContainerEngineHost.PODMAN_REMOTE]: {
      icon: undefined,
      title: "",
      ignore: true
    },
    // Docker
    [ContainerEngineHost.DOCKER_NATIVE]: {
      icon: mdiLinux,
      title: t("Only on Linux"),
      ignore: false
    },
    [ContainerEngineHost.DOCKER_VIRTUALIZED_WSL]: {
      icon: mdiMicrosoftWindows,
      title: t("Only on Microsoft Windows"),
      ignore: false
    },
    [ContainerEngineHost.DOCKER_VIRTUALIZED_LIMA]: {
      icon: mdiApple,
      title: t("Only on Apple MacOS"),
      ignore: false
    },
    [ContainerEngineHost.DOCKER_VIRTUALIZED_VENDOR]: {
      icon: undefined,
      title: "",
      ignore: true
    },
    [ContainerEngineHost.DOCKER_REMOTE]: {
      icon: undefined,
      title: "",
      ignore: true
    }
  };
  const info = platformsMap[host];
  return !info || info.ignore ? null : (
    <div className="RestrictedTo" data-host={host} title={info.title}>
      {info.icon && <ReactIcon.Icon path={info.icon} size={0.75} />}
      {withTitle && <span className="RestrictedToEngineTitle">{info.title}</span>}
    </div>
  );
};
