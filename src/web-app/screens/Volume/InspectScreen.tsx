import { IconNames } from "@blueprintjs/icons";
import i18n from "@/i18n";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useRouteParams, useRouteSearch } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { VolumeActionsMenu } from ".";
import "./InspectScreen.css";
import { getVolumeCrumbs } from "./Navigation";
import { useVolume } from "./queries";

export const ID = "volume.inspect";
export const Title = i18n.t("Volume Inspect");

export interface ScreenProps extends AppScreenProps {}
export const Screen: AppScreen<ScreenProps> = () => {
  const { id } = useRouteParams<{ id: string }>();
  const { connId } = useRouteSearch<{ connId?: string }>();
  const primaryConnectionId = useAppStore((state) => state.currentConnector?.id || "");
  const connectionId = connId || primaryConnectionId;
  const volumeQuery = useVolume(connectionId, id);
  const volume = volumeQuery.data;
  if (!volume) {
    return <ScreenLoader screen={ID} pending={volumeQuery.isLoading || volumeQuery.isFetching} />;
  }
  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader
        withoutSearch
        withBack
        titleText={volume.Name}
        titleIcon={IconNames.DATABASE}
        breadcrumbs={getVolumeCrumbs(volume.Name, connectionId)}
        rightContent={<VolumeActionsMenu volume={volume} withoutCreate />}
      />
      <div className="AppScreenContent">
        <CodeEditor value={JSON.stringify(volume, null, 2)} />
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: "/screens/volumes/$id/inspect",
};
Screen.Metadata = {
  LeftIcon: IconNames.DATABASE,
  ExcludeFromSidebar: true,
};
