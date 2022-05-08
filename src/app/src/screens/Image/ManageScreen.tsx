import { AnchorButton, HTMLTable, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import { useMediaQuery } from "react-responsive";
import dayjs from "dayjs";
import prettyBytes from "pretty-bytes";

// project
import { AppScreenProps, AppScreen, ContainerImage } from "../../Types";
import { usePoller } from "../../Hooks";
import { AppScreenHeader } from "../../components/AppScreenHeader";
import { useAppScreenSearch } from "../../components/AppScreenHooks";
import { useStoreActions, useStoreState } from "../../domain/types";

// module
import { getImageUrl, ActionsMenu } from ".";

import "./ManageScreen.css";

export const ID = "images";

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { t } = useTranslation();
  const isCondensed = useMediaQuery({
    query: "(max-width: 1280px)"
  });
  const fetchAll = useStoreActions((actions) => actions.image.fetchAll);
  const images: ContainerImage[] = useStoreState((state) => state.image.searchByTerm(searchTerm));

  // Change hydration
  usePoller({ poller: fetchAll });

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
            {images.map((image) => {
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
                      <div>{image.Tag}</div>
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
