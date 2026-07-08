import { H5, HTMLTable } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { InspectRawJson, InspectSummary } from "@/web-app/components/InspectSummary";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useRouteParams, useRouteSearch } from "@/web-app/Navigator";
import { getVolumesUrl } from "@/web-app/screens/Volume/Navigation";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { ScreenHeader } from ".";
import "./InspectScreen.css";
import i18n from "@/i18n";
import { buildContainerEnvRows, buildContainerPortRows, buildContainerSummary } from "./inspectSummary";
import { useContainer } from "./queries";

interface VolumeMount {
  source: string;
  destination: string;
}

export const ID = "container.inspect";

interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const { id } = useRouteParams<{ id: string }>();
  const { connId } = useRouteSearch<{ connId?: string }>();
  const primaryConnectionId = useAppStore((state) => state.currentConnector?.id || "");
  const connectionId = connId || primaryConnectionId;
  const decodedId = decodeURIComponent(id || "");
  const containerQuery = useContainer(connectionId, decodedId);
  const { data: container, refetch } = containerQuery;
  const pending = containerQuery.isLoading || containerQuery.isFetching;
  const onScreenReload = useCallback(() => {
    refetch();
  }, [refetch]);

  if (!container) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }

  const envRows = buildContainerEnvRows(container);
  const portRows = buildContainerPortRows(container);
  const volumeMounts: VolumeMount[] = container.Mounts.map((mount) => ({
    source: mount.Source,
    destination: mount.Destination,
  }));
  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader container={container} currentScreen={ID} onReload={onScreenReload} />
      <div className="AppScreenContent">
        <InspectSummary rows={buildContainerSummary(container)} dataTable="container.inspect-summary" />
        {envRows.length > 0 ? (
          <>
            <H5 className="InspectSectionTitle">{t("Environment variables")}</H5>
            <InspectSummary rows={envRows} dataTable="container.inspect-env" />
          </>
        ) : null}
        {volumeMounts.length > 0 ? (
          <>
            <H5 className="InspectSectionTitle">
              <a className="ContainerInspectGroupLink" href={getVolumesUrl("mounts")}>
                {t("Mounts")}
              </a>
            </H5>
            <HTMLTable compact striped className="AppDataTable" data-table="container.inspect">
              <tbody>
                {volumeMounts.map((item, index) => (
                  <tr key={`mount_${item.source}_${item.destination}`}>
                    <td colSpan={2}>
                      <div className="ContainerVolume">
                        <div className="ContainerVolumeIndex">{index + 1}.</div>
                        <ul className="ContainerVolumeMapping">
                          <li>
                            <strong title={t("Host path")}>{t("Host")}</strong>
                            <code>{item.source}</code>
                          </li>
                          <li>
                            <strong title={t("Container path")}>{t("Container")}</strong>
                            <code>{item.destination}</code>
                          </li>
                        </ul>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </HTMLTable>
          </>
        ) : null}
        {portRows.length > 0 ? (
          <>
            <H5 className="InspectSectionTitle">{t("Ports")}</H5>
            <InspectSummary rows={portRows} dataTable="container.inspect-ports" />
          </>
        ) : null}
        <InspectRawJson value={JSON.stringify(container, null, 2)} />
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = i18n.t("Container Inspect");
Screen.Route = {
  Path: "/screens/container/$id/inspect",
};
Screen.Metadata = {
  LeftIcon: IconNames.CUBE,
  ExcludeFromSidebar: true,
};
