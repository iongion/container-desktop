import { NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback } from "react";

import i18n, { t } from "@/i18n";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { InspectRawJson, InspectSummary } from "@/web-app/components/InspectSummary";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useRouteParams } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { ConnectionDetailsActionsMenu } from "./ActionsMenu";
import { getConnectionCrumbs, getConnectionsUrl } from "./Navigation";
import { useSystemInfo } from "./queries";
import { buildSystemInfoSummary } from "./systemInfoSummary";

import "./SystemInfoScreen.css";

interface ScreenProps extends AppScreenProps {}

export const ID = "connections.system-info";
export const View = "system-info";
export const Title = i18n.t("System info");

export const Screen: AppScreen<ScreenProps> = () => {
  const { id } = useRouteParams<{ id: string }>();
  const connectionId = decodeURIComponent(id || "");
  const connections = useAppStore((state) => state.connections);
  const provisioned = useAppStore((state) => state.provisioned);
  const running = useAppStore((state) => state.running);
  const selected = connections.find((item) => item.id === connectionId);
  const title = selected?.name || connectionId;
  const systemInfoQuery = useSystemInfo(connectionId, provisioned && running);
  const { data: systemInfo, refetch } = systemInfoQuery;
  const pending = systemInfoQuery.isLoading || systemInfoQuery.isFetching;
  const onReload = useCallback(() => {
    refetch();
  }, [refetch]);

  let contentWidget: React.ReactNode | null = null;
  if (pending) {
    contentWidget = <ScreenLoader screen={ID} pending={pending} />;
  } else {
    if (provisioned && running) {
      contentWidget = (
        <>
          <InspectSummary rows={buildSystemInfoSummary(systemInfo, selected?.engine)} dataTable="system-info.summary" />
          <InspectRawJson value={JSON.stringify(systemInfo, null, 2)} />
        </>
      );
    } else {
      contentWidget = (
        <NonIdealState
          icon={IconNames.GEOSEARCH}
          title={t("No results")}
          description={
            <p>{t("System info is not available because the app is not connected to a container engine.")}</p>
          }
        />
      );
    }
  }

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader
        withoutSearch
        withBack
        listRoutePath={getConnectionsUrl("manage")}
        listRouteIcon={IconNames.DATA_CONNECTION}
        titleIcon={IconNames.DATA_CONNECTION}
        titleText={title}
        breadcrumbs={getConnectionCrumbs(title, View, connectionId)}
        rightContent={
          <ConnectionDetailsActionsMenu connectionId={connectionId} currentScreen={ID} onReload={onReload} />
        }
      />
      <div className="AppScreenContent">{contentWidget}</div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: `/screens/connections/$id/${View}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.COG,
  ExcludeFromSidebar: true,
};
