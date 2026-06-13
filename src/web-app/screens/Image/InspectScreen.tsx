import { IconNames } from "@blueprintjs/icons";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useRouteParams } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ScreenHeader } from ".";
import "./InspectScreen.css";
import { useImage } from "./queries";

export const ID = "image.inspect";
export const Title = "Image Inspect";

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { id } = useRouteParams<{ id: string }>();
  const connectionId = useAppStore((state) => state.currentConnector?.id || "");
  const decodedId = decodeURIComponent(id || "");
  const imageQuery = useImage(connectionId, decodedId, { Id: decodedId, withHistory: true });
  const image = imageQuery.data;
  if (!image) {
    return <ScreenLoader screen={ID} pending={imageQuery.isLoading || imageQuery.isFetching} />;
  }
  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader image={image} currentScreen={ID} />
      <div className="AppScreenContent">
        <CodeEditor value={JSON.stringify(image, null, 2)} />
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: "/screens/image/$id/inspect",
};
Screen.Metadata = {
  LeftIcon: IconNames.BOX,
  ExcludeFromSidebar: true,
};
