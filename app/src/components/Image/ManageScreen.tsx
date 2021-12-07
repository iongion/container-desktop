import { useCallback, useEffect, useState } from "react";
import { AnchorButton, HTMLTable, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import { useMediaQuery } from "react-responsive";
import dayjs from "dayjs";
import prettyBytes from "pretty-bytes";

import { AppScreen, ContainerImage } from "../../Types";
import { usePoller } from "../../Hooks";
import { getImageUrl, ActionsMenu } from ".";
import { AppScreenHeader } from "../AppScreenHeader";

import { useStoreActions, useStoreState } from "./Model";

import "./ManageScreen.css";

export const ID = "images";

interface ScreenProps {}
export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const isCondensed = useMediaQuery({
    query: "(max-width: 1280px)"
  });
  const imagesFetch = useStoreActions((actions) => actions.imagesFetch);
  const images = useStoreState((state) => state.images);
  const [items, setItems] = useState<ContainerImage[]>(images);
  // Event handlers
  const onSearchChange = useCallback(
    (e) => {
      const needle = e.currentTarget.value.toLowerCase();
      const filtered = images.filter((it) => {
        const haystacks = [it.Name, it.Registry, it.Tag, it.Id, `${it.Size}`].map((t) => t.toLowerCase());
        const matching = haystacks.find((it) => it.includes(needle));
        return !!matching;
      });
      setItems(filtered);
    },
    [images]
  );

  // Change hydration
  useEffect(() => {
    setItems(images);
  }, [images]);

  usePoller({ poller: imagesFetch });

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader onSearch={onSearchChange} />
      <div className="AppScreenContent">
        <HTMLTable striped condensed className="AppDataTable" data-table="images">
          <thead>
            <tr>
              {isCondensed ? (
                <th data-column="NameRegistryTag">{t("Name")}</th>
              ) : (
                <>
                  <th data-column="Name">{t("Name")}</th>
                  <th data-column="Registry">{t("Registry")}</th>
                  <th data-column="Tag">{t("Tag")}</th>
                </>
              )}
              <th data-column="Digest">{t("Digest")}</th>
              <th data-column="Created">{t("Created")}</th>
              <th data-column="Size">{t("Size")}</th>
              <th data-column="Containers">{t("Containers")}</th>
              <th data-column="Actions">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {items.map((image) => {
              console.debug(image);
              const imageLayersButton = (
                <AnchorButton
                  minimal
                  small
                  href={getImageUrl(image.Id, "layers")}
                  text={image.Name}
                  intent={Intent.PRIMARY}
                  icon={IconNames.BOX}
                />
              );
              return (
                <tr key={image.Id} data-image={image.Id}>
                  {isCondensed ? (
                    <td>
                      {imageLayersButton}
                      <div>{image.Names[0] || image.Name}</div>
                    </td>
                  ) : (
                    <>
                      <td>{imageLayersButton}</td>
                      <td>{image.Registry}</td>
                      <td>{image.Tag}</td>
                    </>
                  )}
                  <td>{image.Id.substr(0, 12)}</td>
                  <td>{(dayjs(image.CreatedAt) as any).fromNow()}</td>
                  <td>{prettyBytes(image.Size)}</td>
                  <td>{image.Containers}</td>
                  <td>
                    <ActionsMenu image={image} />
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
Screen.Title = "Images";
Screen.Route = {
  Path: `/screens/${ID}`
};
Screen.Metadata = {
  LeftIcon: IconNames.BOX
};
