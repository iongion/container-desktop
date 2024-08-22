import { IconNames } from "@blueprintjs/icons";
import { useEffect } from "react";

import { CodeEditor } from "@/web-app/components/CodeEditor";
import { useStoreActions, useStoreState } from "@/web-app/domain/types";
import { AppScreen, AppScreenProps } from "@/web-app/Types";
import { ScreenHeader } from "./ScreenHeader";

import "./SystemInfoScreen.css";

// Screen

interface ScreenProps extends AppScreenProps {}

export const ID = "settings.system-info";
export const View = "system-info";
export const Title = "System info";

export const Screen: AppScreen<ScreenProps> = () => {
  const provisioned = useStoreState((state) => state.provisioned);
  const running = useStoreState((state) => state.running);
  const systemInfo = useStoreState((state) => state.settings.systemInfo);
  const systemDetailsViewer = provisioned && running ? <CodeEditor value={JSON.stringify(systemInfo, null, 2)} /> : null;

  const getSystemInfo = useStoreActions((actions) => actions.settings.getSystemInfo);

  useEffect(() => {
    (async () => {
      await getSystemInfo();
    })();
  }, [getSystemInfo]);

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader currentScreen={ID} />
      <div className="AppScreenContent">{systemDetailsViewer}</div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: `/screens/settings/${View}`
};
Screen.Metadata = {
  LeftIcon: IconNames.COG,
  ExcludeFromSidebar: true
};
