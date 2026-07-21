import { AnchorButton, FormGroup, HTMLTable, Icon, InputGroup, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { ContainerStateList } from "@/container-client/types/container";
import { ContainerEngineHost } from "@/container-client/types/engine";
import { OperatingSystem } from "@/container-client/types/os";
import i18n from "@/i18n";
import { CopyButton } from "@/web-app/components/CopyButton";
import { CONTAINER_DOCS_EXAMPLE_CODE, CONTAINER_DOCS_URL } from "@/web-app/Environment";
import { useMergedResources } from "@/web-app/hooks/useMergedResources";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import "./Dashboard.css";

export const ID = "dashboard";
export const Title = i18n.t("Dashboard");

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const osType = useAppStore((state) => state.osType);
  const currentConnector = useAppStore((state) => state.currentConnector);
  // Always-merged workspace: aggregate container stats across every connected engine.
  const containers = useMergedResources("containers");
  const host = currentConnector?.host;
  const program = currentConnector?.settings.program;
  const scope = currentConnector?.settings.controller?.scope || "";

  const containerStats = useMemo(() => {
    return containers.reduce(
      (acc, container) => {
        switch (container.Computed.DecodedState) {
          case ContainerStateList.PAUSED:
            acc.paused += 1;
            break;
          case ContainerStateList.RUNNING:
            acc.running += 1;
            break;
          case ContainerStateList.EXITED:
            acc.exited += 1;
            break;
          case ContainerStateList.CREATED:
            acc.created += 1;
            break;
          default:
            break;
        }
        return acc;
      },
      {
        paused: 0,
        running: 0,
        exited: 0,
        created: 0,
      },
    );
  }, [containers]);

  const { exampleCode, commandPrefix, commandTitle } = useMemo(() => {
    const programName = program?.name || "podman";
    const exampleCode = CONTAINER_DOCS_EXAMPLE_CODE.replace("{program}", programName);
    let commandPrefix = "";
    let commandTitle: any;
    if (osType === OperatingSystem.Windows) {
      if (host === ContainerEngineHost.PODMAN_VIRTUALIZED_WSL || host === ContainerEngineHost.DOCKER_VIRTUALIZED_WSL) {
        commandPrefix = `wsl.exe --distribution ${scope} --exec bash -i -l`;
        commandTitle = t(
          "On WSL, to dissociated between commands targeting the native podman host, a wsl prefix must be used.",
        );
      }
    } else if (osType === OperatingSystem.MacOS) {
      if (
        host === ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA ||
        host === ContainerEngineHost.DOCKER_VIRTUALIZED_LIMA
      ) {
        commandPrefix = `limactl shell ${scope}`;
        commandTitle = t(
          "On MacOS, to dissociated between commands targeting the native podman host, a limactl prefix must be used.",
        );
      }
    }
    return {
      exampleCode,
      commandPrefix,
      commandTitle,
    };
  }, [t, host, osType, scope, program]);

  return (
    <div className="AppScreen" data-screen={ID}>
      <div className="AppScreenContent">
        <NonIdealState
          icon={<Icon icon={IconNames.CUBE} size={120} />}
          title={t("containersRunning", {
            count: containerStats.running,
            context: `${containerStats.running}`,
          })}
          description={
            <div className="AppScreenContentViewport">
              <HTMLTable className="DashboardContainersReportTable" striped compact bordered>
                <tbody>
                  <tr>
                    <td>{t("Paused")}</td>
                    <td>{containerStats.paused}</td>
                  </tr>
                  <tr>
                    <td>{t("Exited")}</td>
                    <td>{containerStats.exited}</td>
                  </tr>
                  <tr>
                    <td>{t("Created")}</td>
                    <td>{containerStats.created}</td>
                  </tr>
                </tbody>
              </HTMLTable>
              <p>{t("As an example, copy and paste this command into your terminal and then come back")}</p>
              <FormGroup helperText={commandPrefix ? commandPrefix : ""}>
                <InputGroup
                  title={commandTitle}
                  className="DashboardContainerExampleCode"
                  value={exampleCode}
                  readOnly
                  rightElement={<CopyButton text={exampleCode} />}
                />
              </FormGroup>
              <AnchorButton
                className="DashboardContainerDocsUrl"
                href={CONTAINER_DOCS_URL}
                target="_blank"
                variant="minimal"
                icon={IconNames.LINK}
                text={t("Explore more in the docs")}
                intent={Intent.PRIMARY}
              />
            </div>
          }
        />
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: "/",
};
Screen.Metadata = {
  LeftIcon: IconNames.DASHBOARD,
};
