import { AnchorButton, Code, HTMLTable, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import dayjs from "dayjs";

// project
import { ApplicationDescriptor, Secret } from "../../Types.container-app";

// module
import { usePoller } from "../../Hooks";
import { AppScreen, AppScreenProps } from "../../Types";
import { AppLabel } from "../../components/AppLabel";
import { AppScreenHeader } from "../../components/AppScreenHeader";
import { useAppScreenSearch } from "../../components/AppScreenHooks";
import { useStoreActions, useStoreState } from "../../domain/types";
import { getSecretUrl } from "./Navigation";

// module
import { SecretActionsMenu } from ".";

import "./ManageScreen.css";

export const ID = "secrets";

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { t } = useTranslation();
  const secretsFetch = useStoreActions((actions) => actions.secret.secretsFetch);
  const secrets: Secret[] = useStoreState((state) => state.secret.secretsSearchByTerm(searchTerm));

  // Change hydration
  usePoller({ poller: secretsFetch });

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader
        searchTerm={searchTerm}
        onSearch={onSearchChange}
        titleIcon={IconNames.KEY}
        rightContent={<SecretActionsMenu />}
      />
      <div className="AppScreenContent">
        <HTMLTable interactive compact striped className="AppDataTable" data-table="secrets">
          <thead>
            <tr>
              <th data-column="Name">
                <AppLabel iconName={IconNames.KEY} text={t("Name")} />
              </th>
              <th data-column="Id">
                <AppLabel iconName={IconNames.BARCODE} text={t("Id")} />
              </th>
              <th data-column="Updated">
                <AppLabel iconName={IconNames.CALENDAR} text={t("Updated")} />
              </th>
              <th data-column="Created">
                <AppLabel iconName={IconNames.CALENDAR} text={t("Created")} />
              </th>
              <th data-column="Actions">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {secrets.map((secret) => {
              return (
                <tr key={secret.ID}>
                  <td>
                    <AnchorButton
                      className="PodDetailsButton"
                      minimal
                      small
                      href={getSecretUrl(secret.ID, "inspect")}
                      text={secret.Spec.Name}
                      intent={Intent.PRIMARY}
                      icon={IconNames.EYE_OPEN}
                    />
                  </td>
                  <td>
                    <Code>{secret.ID}</Code>
                  </td>
                  <td>{(dayjs(secret.CreatedAt) as any).fromNow()}</td>
                  <td>{(dayjs(secret.CreatedAt) as any).fromNow()}</td>
                  <td>
                    <SecretActionsMenu withoutCreate secret={secret} />
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
Screen.Title = "Secrets";
Screen.Route = {
  Path: `/screens/${ID}`
};
Screen.Metadata = {
  LeftIcon: IconNames.KEY
};
Screen.isAvailable = (context: ApplicationDescriptor) => {
  return !context.currentConnector.engine.startsWith("docker");
};
