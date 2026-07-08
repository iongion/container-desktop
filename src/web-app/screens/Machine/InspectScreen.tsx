import { IconNames } from "@blueprintjs/icons";
import i18n from "@/i18n";
import { InspectRawJson, InspectSummary } from "@/web-app/components/InspectSummary";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useRouteParams, useRouteSearch } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ScreenHeader } from ".";
import { buildMachineSummary } from "./inspectSummary";
import { useMachine } from "./queries";

import "./InspectScreen.css";

export const ID = "machine.inspect";
export const Title = i18n.t("Machine Inspect");

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { name } = useRouteParams<{ name: string }>();
  const { connId } = useRouteSearch<{ connId?: string }>();
  const primaryConnectionId = useAppStore((state) => state.currentConnector?.id || "");
  const connectionId = connId || primaryConnectionId;
  const machineQuery = useMachine(connectionId, name);
  const machine = machineQuery.data;
  if (!machine) {
    return <ScreenLoader screen={ID} pending={machineQuery.isLoading || machineQuery.isFetching} />;
  }
  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader machine={machine} connectionId={connectionId} currentScreen={ID} />
      <div className="AppScreenContent">
        <InspectSummary rows={buildMachineSummary(machine)} dataTable="machine.inspect-summary" />
        <InspectRawJson value={JSON.stringify(machine, null, 2)} />
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
