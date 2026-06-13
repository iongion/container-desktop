import { IconNames } from "@blueprintjs/icons";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useRouteParams } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { VolumeActionsMenu } from ".";
import "./InspectScreen.css";
import { useVolume } from "./queries";

export const ID = "volume.inspect";
export const Title = "Volume Inspect";

export interface ScreenProps extends AppScreenProps {}
export const Screen: AppScreen<ScreenProps> = () => {
  const { id } = useRouteParams<{ id: string }>();
  const connectionId = useAppStore((state) => state.currentConnector?.id || "");
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
