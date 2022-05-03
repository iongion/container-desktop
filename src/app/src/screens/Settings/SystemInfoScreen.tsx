import { IconNames } from "@blueprintjs/icons";

// project
import { AppScreen, AppScreenProps } from "../../Types";
import { ScreenHeader } from "./ScreenHeader";
import { CodeEditor } from "../../components/CodeEditor";
import { useStoreState } from "../../domain/types";

// module

import "./SystemInfoScreen.css";

// Screen

interface ScreenProps extends AppScreenProps {}

export const ID = "settings.system-info";
export const View = "system-info";
export const Title = "System info";

export const Screen: AppScreen<ScreenProps> = () => {
  const provisioned = useStoreState((state) => state.descriptor.provisioned);
  const running = useStoreState((state) => state.descriptor.running);
  const system = {}; // useStoreState((state) => state.descriptor.system);
  const systemDetailsViewer = provisioned && running ? <CodeEditor value={JSON.stringify(system, null, 2)} /> : null;
  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader currentScreen={ID} />
      <div className="AppScreenContent">
        {systemDetailsViewer}
      </div>
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
