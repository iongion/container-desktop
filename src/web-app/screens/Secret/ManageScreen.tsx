import { AnchorButton, Code, HTMLTable, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import dayjs from "dayjs";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { Connector, Secret } from "@/env/Types";
import { AppLabel } from "@/web-app/components/AppLabel";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { SortableColumnHeader } from "@/web-app/components/SortableColumnHeader";
import { sortAlphaNum } from "@/web-app/domain/utils";
import { useColumnSort } from "@/web-app/hooks/useColumnSort";
import { useAppStore } from "@/web-app/stores/appStore";
import { resourceEvents } from "@/web-app/stores/resourceEvents";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { sortByField, type SortSelectors } from "@/web-app/utils/comparators";

import { SecretActionsMenu } from ".";
import "./ManageScreen.css";
import { getSecretUrl } from "./Navigation";

export const ID = "secrets";

export interface ScreenProps extends AppScreenProps {}

const EMPTY_SECRETS: Secret[] = [];

const createSecretSearchFilter = (searchTerm: string) => {
  const query = searchTerm.toLowerCase();
  return (secret: Secret) => {
    const haystacks = [secret.ID, secret.Spec?.Name || "", secret.Spec?.Driver?.Name || ""].map((value) =>
      value.toLowerCase(),
    );
    return haystacks.some((value) => value.includes(query));
  };
};

const secretSortSelectors: SortSelectors<Secret> = {
  name: (secret) => secret.Spec?.Name || "",
  id: (secret) => secret.ID,
  updated: (secret) => Date.parse(secret.UpdatedAt || secret.CreatedAt || ""),
  created: (secret) => Date.parse(secret.CreatedAt || ""),
};

export const Screen: AppScreen<ScreenProps> = () => {
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { t } = useTranslation();
  const currentConnector = useAppStore((state) => state.currentConnector);
  const connectionId = currentConnector?.id;
  const { clientSort, getColumnSortDirection, toggleColumnSort } = useColumnSort(
    ID,
    currentConnector?.capabilities?.sort,
  );
  const secretSnapshot = useResourceStore((state) =>
    connectionId ? state.byConnection[connectionId]?.secrets.items || EMPTY_SECRETS : EMPTY_SECRETS,
  );
  const secrets = useMemo(() => {
    const items = searchTerm ? secretSnapshot.filter(createSecretSearchFilter(searchTerm)) : secretSnapshot;
    return clientSort
      ? sortByField(items, clientSort, secretSortSelectors)
      : [...items].sort((a, b) => sortAlphaNum(a.Spec?.Name || "", b.Spec?.Name || ""));
  }, [clientSort, secretSnapshot, searchTerm]);
  const onReload = useCallback(() => {
    if (connectionId) {
      resourceEvents.refresh(connectionId, "secrets");
    }
  }, [connectionId]);

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader
        searchTerm={searchTerm}
        onSearch={onSearchChange}
        titleIcon={IconNames.KEY}
        rightContent={<SecretActionsMenu onReload={onReload} />}
      />
      <div className="AppScreenContent">
        {secrets.length === 0 ? (
          <NonIdealState
            icon={IconNames.GEOSEARCH}
            title={t("No results")}
            description={<p>{t("There are no secrets")}</p>}
          />
        ) : (
          <HTMLTable interactive compact striped className="AppDataTable" data-table="secrets">
            <thead>
              <tr>
                <SortableColumnHeader
                  field="name"
                  direction={getColumnSortDirection("name")}
                  onSort={toggleColumnSort}
                >
                  <AppLabel iconName={IconNames.KEY} text={t("Name")} />
                </SortableColumnHeader>
                <SortableColumnHeader field="id" direction={getColumnSortDirection("id")} onSort={toggleColumnSort}>
                  <AppLabel iconName={IconNames.BARCODE} text={t("Id")} />
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="updated"
                  direction={getColumnSortDirection("updated")}
                  onSort={toggleColumnSort}
                >
                  <AppLabel iconName={IconNames.CALENDAR} text={t("Updated")} />
                </SortableColumnHeader>
                <SortableColumnHeader
                  field="created"
                  direction={getColumnSortDirection("created")}
                  onSort={toggleColumnSort}
                >
                  <AppLabel iconName={IconNames.CALENDAR} text={t("Created")} />
                </SortableColumnHeader>
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
        )}
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Secrets";
Screen.Route = {
  Path: `/screens/${ID}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.KEY,
};
Screen.isAvailable = (currentConnector?: Connector) => {
  return currentConnector?.capabilities?.resources.secrets === true;
};
