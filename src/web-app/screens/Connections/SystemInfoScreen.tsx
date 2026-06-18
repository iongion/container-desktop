import { NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";

import { t } from "@/web-app/App.i18n";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { useSystemInfo } from "./queries";
import { ScreenHeader } from "./ScreenHeader";

import "./SystemInfoScreen.css";

interface ScreenProps extends AppScreenProps {}

export const ID = "connections.system-info";
export const View = "system-info";
export const Title = "System info";

export const Screen: AppScreen<ScreenProps> = () => {
  const provisioned = useAppStore((state) => state.provisioned);
  const running = useAppStore((state) => state.running);
  const currentConnector = useAppStore((state) => state.currentConnector);
  const systemInfoQuery = useSystemInfo(currentConnector?.id || "", provisioned && running);
  const systemInfo = systemInfoQuery.data;
  const pending = systemInfoQuery.isLoading || systemInfoQuery.isFetching;

  let contentWidget: React.ReactNode | null = null;
  if (pending) {
    contentWidget = <ScreenLoader screen={ID} pending={pending} />;
  } else {
    if (provisioned && running) {
      contentWidget = <CodeEditor value={JSON.stringify(systemInfo, null, 2)} />;
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
      <ScreenHeader currentScreen={ID} titleText={currentConnector?.name || ""} />
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
