import { NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useState } from "react";

import i18n, { t } from "@/i18n";
import { ConnectionSelect } from "@/web-app/components/ConnectionSelect";
import { InspectRawJson, InspectSummary } from "@/web-app/components/InspectSummary";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { useSystemInfo } from "./queries";
import { ScreenHeader } from "./ScreenHeader";
import { buildSystemInfoSummary } from "./systemInfoSummary";

import "./SystemInfoScreen.css";

interface ScreenProps extends AppScreenProps {}

export const ID = "connections.system-info";
export const View = "system-info";
export const Title = i18n.t("System info");

export const Screen: AppScreen<ScreenProps> = () => {
  const connections = useAppStore((state) => state.connections);
  const provisioned = useAppStore((state) => state.provisioned);
  const running = useAppStore((state) => state.running);
  const currentConnector = useAppStore((state) => state.currentConnector);
  // Always-merged workspace: pick WHICH connected connection to inspect (defaults to the primary), mirroring
  // the Connection info screen. The query targets the selected connection's host (see useSystemInfo).
  const [connectionId, setConnectionId] = useState("");
  const selected = connections.find((item) => item.id === connectionId) ?? currentConnector;
  const systemInfoQuery = useSystemInfo(selected?.id || "", provisioned && running);
  const systemInfo = systemInfoQuery.data;
  const pending = systemInfoQuery.isLoading || systemInfoQuery.isFetching;

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
      <ScreenHeader
        currentScreen={ID}
        centerContent={
          <>
            <div className="ScreenHeaderSpacer" />
            <ConnectionSelect value={connectionId} onChange={setConnectionId} inline />
          </>
        }
      />
      <div className="AppScreenContent">{contentWidget}</div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: `/screens/connections/${View}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.COG,
  ExcludeFromSidebar: true,
};
