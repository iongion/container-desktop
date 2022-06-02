import { AnchorButton, Code, HTMLTable, Icon, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import prettyBytes from "pretty-bytes";
import { mdiCubeUnfolded } from "@mdi/js";

// project
import { AppScreenProps, AppScreen } from "../../Types";
import { usePoller } from "../../Hooks";
import { AppScreenHeader } from "../../components/AppScreenHeader";
import { useAppScreenSearch } from "../../components/AppScreenHooks";
import { AppLabel } from "../../components/AppLabel";
import { useStoreActions, useStoreState } from "../../domain/types";

// module
import { getImageUrl, ActionsMenu } from ".";

import "./ManageScreen.css";
import { ContainerImage } from "../../Types.container-app";

export const ID = "images";

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { t } = useTranslation();
  const fetchAll = useStoreActions((actions) => actions.image.fetchAll);
  const images: ContainerImage[] = useStoreState((state) => state.image.searchByTerm(searchTerm));

  // Change hydration
  usePoller({ poller: fetchAll });

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader searchTerm={searchTerm} onSearch={onSearchChange} />
      <div className="AppScreenContent">
        <HTMLTable interactive striped condensed className="AppDataTable" data-table="images">
          <thead>
            <tr>
              <th data-column="Name"><AppLabel iconName={IconNames.BOX} text={t("Name")} /></th>
              <th data-column="Registry"><AppLabel iconPath={mdiCubeUnfolded} text={t("Registry")} /></th>
              <th data-column="Tag"><AppLabel iconName={IconNames.TAG} text={t("Tag")} /></th>
              <th data-column="Id" title={t("First 12 characters")}><AppLabel iconName={IconNames.BARCODE} text={t("Id")} /></th>
              <th data-column="Size">{t("Size")}</th>
              <th data-column="Containers" title={t("Count of containers using the image")}><Icon icon={IconNames.CUBE} /></th>
              <th data-column="Created"><AppLabel iconName={IconNames.CALENDAR} text={t("Created")} /></th>
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
                  icon={IconNames.LAYERS}
                />
              );
              return (
                <tr key={image.Id} data-image={image.Id}>
                  <td>{imageLayersButton}</td>
                  <td>{image.Registry}</td>
                  <td>{image.Tag}</td>
                  <td><Code>{image.Id.substring(0, 12)}</Code></td>
                  <td>{prettyBytes(image.Size)}</td>
                  <td><Code>{image.Containers}</Code></td>
                  <td>{(dayjs(image.Created * 1000) as any).format("DD MMM YYYY HH:mm")}</td>
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
