import { useEffect, useRef, useState } from "react";
import { Button, Intent, HTMLTable } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import prettyBytes from "pretty-bytes";
import ClipboardJS from "clipboard";

import { useParams } from "react-router-dom";

// project
import { AppScreenProps, AppScreen, ContainerImage } from "../../Types";
import { Notification } from "../../Notification";
import { ScreenLoader } from "../../components/ScreenLoader";
import { useStoreActions } from "../../domain/types";

// module
import { ScreenHeader } from ".";

import "./LayersScreen.css";


export const ID = "image.layers";

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const [pending, setPending] = useState(true);
  const [image, setImage] = useState<ContainerImage>();
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const clipboardRef = useRef<ClipboardJS>();
  const screenRef = useRef<HTMLDivElement>(null);
  const fetchOne = useStoreActions((actions) => actions.image.fetchOne);
  useEffect(() => {
    (async () => {
      try {
        setPending(true);
        const image = await fetchOne({
          Id: id,
          withHistory: true
        });
        setImage(image);
      } catch (error) {
        console.error("Unable to fetch at this moment", error);
      } finally {
        setPending(false);
      }
    })();
  }, [fetchOne, id]);
  useEffect(() => {
    if (!image || !screenRef.current) {
      return;
    }
    if (clipboardRef.current) {
      clipboardRef.current.destroy();
    }
    clipboardRef.current = new ClipboardJS(screenRef.current.querySelectorAll('[data-action="copy.to.clipboard"]'), {
      text: (trigger: Element): string => {
        Notification.show({ message: t("The command was copied to clipboard"), intent: Intent.SUCCESS });
        return (
          trigger.parentElement?.parentElement?.querySelector<HTMLTableCellElement>("tr td:nth-child(2)")?.innerText ||
          ""
        );
      }
    });
  }, [image, t]);
  if (!image) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }
  const layers = image.History || [];

  return (
    <div className="AppScreen" data-screen={ID} ref={screenRef}>
      <ScreenHeader image={image} currentScreen={ID} />
      <div className="AppScreenContent">
        <HTMLTable condensed striped interactive className="AppDataTable" data-table="image.layers.history">
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
                  <td>{index}</td>
                  <td>{layer.CreatedBy}</td>
                  <td>{layer.Size !== undefined ? prettyBytes(layer.Size) : t("- n/a -")}</td>
                  <td>
                    <Button small minimal icon={IconNames.CLIPBOARD} data-action="copy.to.clipboard" />
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
