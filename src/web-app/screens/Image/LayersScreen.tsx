import { Button, HTMLTable, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import prettyBytes from "pretty-bytes";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import { ContainerImage } from "@/env/Types";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useStoreActions } from "@/web-app/domain/types";
import { Notification } from "@/web-app/Notification";
import { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ScreenHeader } from ".";
import "./LayersScreen.css";

export const ID = "image.layers";

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const [pending, setPending] = useState(true);
  const [image, setImage] = useState<ContainerImage>();
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const screenRef = useRef<HTMLDivElement>(null);
  const imageFetch = useStoreActions((actions) => actions.image.imageFetch);
  const onCopyToClipboardClick = useCallback(
    async (e) => {
      const contentNode = e.currentTarget?.parentNode.closest("tr").querySelector("td:nth-child(2)");
      await navigator.clipboard.writeText(contentNode?.innerText || "");
      Notification.show({ message: t("The command was copied to clipboard"), intent: Intent.SUCCESS });
    },
    [t]
  );
  const layers = image?.History || [];

  useEffect(() => {
    (async () => {
      try {
        setPending(true);
        const image = await imageFetch({
          Id: decodeURIComponent(id as any),
          withHistory: true
        });
        setImage(image);
      } catch (error: any) {
        console.error("Unable to fetch at this moment", error);
        Notification.show({ message: t("Unable to load image - {{message}}", error), intent: Intent.DANGER });
        history.back();
      } finally {
        setPending(false);
      }
    })();
  }, [imageFetch, id, t]);

  if (!image) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }

  return (
    <div className="AppScreen" data-screen={ID} ref={screenRef}>
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
              return (
                <tr key={index}>
                  <td>
                    <strong className="LayerIndex">{index + 1}.</strong>
                  </td>
                  <td>
                    <div className="LayerHistory">{layer.CreatedBy || ""}</div>
                  </td>
                  <td>{layer.Size !== undefined ? prettyBytes(layer.Size) : t("- n/a -")}</td>
                  <td>
                    <Button small minimal icon={IconNames.CLIPBOARD} data-action="copy.to.clipboard" onClick={onCopyToClipboardClick} />
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
  Path: `/screens/image/:id/layers`
};
Screen.Metadata = {
  LeftIcon: IconNames.BOX,
  ExcludeFromSidebar: true
};
