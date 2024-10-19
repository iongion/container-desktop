import { NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useEffect } from "react";

import { t } from "@/web-app/App.i18n";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useStoreActions, useStoreState } from "@/web-app/domain/types";
import { ScreenHeader } from "./ScreenHeader";

import "./SystemInfoScreen.css";

interface ScreenProps extends AppScreenProps {}

export const ID = "settings.system-info";
export const View = "system-info";
export const Title = "System info";

export const Screen: AppScreen<ScreenProps> = () => {
  const provisioned = useStoreState((state) => state.provisioned);
  const running = useStoreState((state) => state.running);
  const pending = useStoreState((state) => state.pending);
  const currentConnector = useStoreState((state) => state.currentConnector);
  const systemInfo = useStoreState((state) => state.settings.systemInfo);
  const getSystemInfo = useStoreActions((actions) => actions.settings.getSystemInfo);

  useEffect(() => {
    (async () => {
      await getSystemInfo();
    })();
  }, [getSystemInfo]);

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

  console.debug(currentConnector);

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
  Path: `/screens/settings/${View}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.COG,
  ExcludeFromSidebar: true,
};
