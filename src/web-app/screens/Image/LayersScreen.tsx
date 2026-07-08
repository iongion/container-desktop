import { IconNames } from "@blueprintjs/icons";
import i18n from "@/i18n";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useRouteParams, useRouteSearch } from "@/web-app/Navigator";
import { LayerInspector } from "@/web-app/screens/Build/LayerInspector";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { ScreenHeader } from ".";
import { useImage, useImageHistory } from "./queries";
import "./LayersScreen.css";

export const ID = "image.layers";

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { id } = useRouteParams<{ id: string }>();
  const { connId } = useRouteSearch<{ connId?: string }>();
  const primaryConnectionId = useAppStore((state) => state.currentConnector?.id || "");
  const connectionId = connId || primaryConnectionId;
  const decodedId = decodeURIComponent(id || "");
  const imageQuery = useImage(connectionId, decodedId);
  const historyQuery = useImageHistory(connectionId, decodedId);
  const image = imageQuery.data;
  const pending = imageQuery.isLoading || imageQuery.isFetching || historyQuery.isLoading || historyQuery.isFetching;
  const layers = historyQuery.data || image?.History || [];

  if (!image) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader image={image} currentScreen={ID} />
      <div className="AppScreenContent">
        <LayerInspector history={layers} />
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = i18n.t("Image Layers");
Screen.Route = {
  Path: "/screens/image/$id/layers",
};
Screen.Metadata = {
  LeftIcon: IconNames.BOX,
  ExcludeFromSidebar: true,
};
