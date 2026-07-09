import { IconNames } from "@blueprintjs/icons";
import i18n from "@/i18n";
import { ResourceInspectTabs } from "@/web-app/components/ResourceInspectTabs";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useRouteParams, useRouteSearch } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ScreenHeader } from ".";
import "./InspectScreen.css";
import { buildImageSummary } from "./inspectSummary";
import { useImage } from "./queries";

export const ID = "image.inspect";
export const Title = i18n.t("Image Inspect");

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { id } = useRouteParams<{ id: string }>();
  const { connId } = useRouteSearch<{ connId?: string }>();
  const primaryConnectionId = useAppStore((state) => state.currentConnector?.id || "");
  const connectionId = connId || primaryConnectionId;
  const decodedId = decodeURIComponent(id || "");
  const imageQuery = useImage(connectionId, decodedId, { Id: decodedId, withHistory: true });
  const image = imageQuery.data;
  if (!image) {
    return <ScreenLoader screen={ID} pending={imageQuery.isLoading || imageQuery.isFetching} />;
  }
  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader image={image} currentScreen={ID} />
      <ResourceInspectTabs
        dataScreen={ID}
        summaryRows={buildImageSummary(image)}
        summaryTable="image.inspect-summary"
        rawValue={JSON.stringify(image, null, 2)}
      />
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
