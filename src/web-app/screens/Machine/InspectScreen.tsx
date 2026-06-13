import { IconNames } from "@blueprintjs/icons";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useRouteParams } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ScreenHeader } from ".";
import { useMachine } from "./queries";

import "./InspectScreen.css";

export const ID = "machine.inspect";
export const Title = "Machine Inspect";

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { name } = useRouteParams<{ name: string }>();
  const connectionId = useAppStore((state) => state.currentConnector?.id || "");
  const machineQuery = useMachine(connectionId, name);
  const machine = machineQuery.data;
  if (!machine) {
    return <ScreenLoader screen={ID} pending={machineQuery.isLoading || machineQuery.isFetching} />;
  }
  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader machine={machine} currentScreen={ID} />
      <div className="AppScreenContent">
        <CodeEditor value={JSON.stringify(machine, null, 2)} />
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: "/screens/machines/$name/inspect",
};
Screen.Metadata = {
  LeftIcon: IconNames.HEAT_GRID,
  ExcludeFromSidebar: true,
};
