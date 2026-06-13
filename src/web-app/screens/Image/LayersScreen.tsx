import { Button, HTMLTable, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import prettyBytes from "pretty-bytes";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useRouteParams } from "@/web-app/Navigator";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ScreenHeader } from ".";
import "./LayersScreen.css";
import { useImage, useImageHistory } from "./queries";

export const ID = "image.layers";

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const { id } = useRouteParams<{ id: string }>();
  const connectionId = useAppStore((state) => state.currentConnector?.id || "");
  const decodedId = decodeURIComponent(id || "");
  const imageQuery = useImage(connectionId, decodedId);
  const historyQuery = useImageHistory(connectionId, decodedId);
  const image = imageQuery.data;
  const pending = imageQuery.isLoading || imageQuery.isFetching || historyQuery.isLoading || historyQuery.isFetching;
  const onCopyToClipboardClick = useCallback(
    async (e) => {
      const contentNode = e.currentTarget?.parentNode.closest("tr").querySelector("td:nth-child(2)");
      await navigator.clipboard.writeText(contentNode?.innerText || "");
      Notification.show({
        message: t("The command was copied to clipboard"),
        intent: Intent.SUCCESS,
      });
    },
    [t],
  );
  const layers = historyQuery.data || image?.History || [];

  if (!image) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader image={image} currentScreen={ID} />
      <div className="AppScreenContent">
        <HTMLTable compact striped className="AppDataTable" data-table="image.layers.history">
          <thead>
            <tr>
              <th data-column="layer">#</th>
              <th data-column="CreatedBy">{t("Created By")}</th>
              <th data-column="Size">{t("Size")}</th>
              <th>&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {layers.map((layer, index) => {
              const layerKey = layer.id || `l-${index}`;
              return (
                <tr key={layerKey}>
                  <td>
                    <strong className="LayerIndex">{index + 1}.</strong>
                  </td>
                  <td>
                    <div className="LayerHistory">{layer.CreatedBy || ""}</div>
                  </td>
                  <td>{layer.Size !== undefined ? prettyBytes(layer.Size) : t("- n/a -")}</td>
                  <td>
                    <Button
                      small
                      minimal
                      icon={IconNames.CLIPBOARD}
                      data-action="copy.to.clipboard"
                      onClick={onCopyToClipboardClick}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </HTMLTable>
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Image Layers";
Screen.Route = {
  Path: "/screens/image/$id/layers",
};
Screen.Metadata = {
  LeftIcon: IconNames.BOX,
  ExcludeFromSidebar: true,
};
