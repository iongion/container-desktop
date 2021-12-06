import { useCallback, useState } from "react";
import { HTMLTable, Icon } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { IconNames } from "@blueprintjs/icons";

import dayjs from "dayjs";

import { AppScreen } from "../../Types";
import { useStoreActions, useStoreState } from "../../Domain";
import { usePoller } from "../../Hooks";
import { AppScreenHeader } from "../AppScreenHeader";

import "./ManageScreen.css";

import { SecretActionsMenu } from ".";

export const ID = "secrets";

interface ScreenProps {}
export const Screen: AppScreen<ScreenProps> = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const { t } = useTranslation();
  const secretsFetch = useStoreActions((actions) => actions.secretsFetch);
  const secrets = useStoreState((state) => state.secretsSearchByTerm(searchTerm));
  const onSearchChange = useCallback(
    (e) => {
      const needle = e.currentTarget.value.toLowerCase();
      setSearchTerm(needle);
    },
    [setSearchTerm]
  );

  // Change hydration

  usePoller({ poller: secretsFetch });

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader onSearch={onSearchChange} titleIcon={IconNames.KEY} rightContent={<SecretActionsMenu />} />
      <div className="AppScreenContent">
        <HTMLTable condensed striped className="AppDataTable" data-table="secrets">
          <thead>
            <tr>
              <th data-column="ID">{t("ID")}</th>
              <th data-column="Name">{t("Name")}</th>
              <th data-column="Updated">{t("Updated")}</th>
              <th data-column="Created">{t("Created")}</th>
              <th data-column="Actions">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {secrets.map((secret) => {
              return (
                <tr key={secret.ID}>
                  <td>
                    <Icon icon={IconNames.KEY} />
                    &nbsp;{secret.ID}
                  </td>
                  <td>{secret.Spec.Name}</td>
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
