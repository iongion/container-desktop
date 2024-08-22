import { Button, ButtonGroup, Classes, Drawer, DrawerSize, HTMLTable, Intent, ProgressBar } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { RegistrySearchResult } from "@/env/Types";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import { Notification } from "@/web-app/Notification";

import { Application } from "@/container-client/Application";
import "./SearchResultDrawer.css";

export interface CreateFormData {
  registryName: string;
}

export interface FormActionsProps {
  onClose: () => void;
  searchResult: RegistrySearchResult;
}
export const FormActions: React.FC<FormActionsProps> = ({ searchResult, onClose }: FormActionsProps) => {
  const [pending, setPending] = useState(false);
  const { t } = useTranslation();
  const onPullClick = useCallback(async () => {
    setPending(true);
    try {
      const instance = Application.getInstance();
      const result = await instance.pullFromRegistry({ image: searchResult.Name });
      setPending(false);
      if (result.success) {
        Notification.show({ message: t("Pull completed successfully"), intent: Intent.SUCCESS });
        onClose();
      } else {
        Notification.show({ message: t("Pull failed - check the logs"), intent: Intent.DANGER });
      }
    } catch (error: any) {
      console.error("Error while performing image pull", error);
      Notification.show({ message: t("Pull failed - check the logs"), intent: Intent.DANGER });
      setPending(false);
    }
  }, [onClose, searchResult, t]);
  const pendingIndicator = <div className="AppDrawerPendingIndicator">{pending && <ProgressBar intent={Intent.SUCCESS} />}</div>;
  return (
    <>
      <ButtonGroup fill>
        <Button
          disabled={pending}
          intent={Intent.PRIMARY}
          icon={IconNames.DOWNLOAD}
          title={t("Click to launch retrieval")}
          text={t("Pull latest")}
          type="submit"
          onClick={onPullClick}
        />
      </ButtonGroup>
      {pendingIndicator}
    </>
  );
};

export interface SearchResultDrawerProps {
  onClose: () => void;
  searchResult: RegistrySearchResult;
}
export const SearchResultDrawer: React.FC<SearchResultDrawerProps> = ({ onClose, searchResult }: SearchResultDrawerProps) => {
  const { t } = useTranslation();
  return (
    <Drawer
      className="AppDrawer AppDrawerRegistrySearchResults"
      icon={IconNames.LIST_DETAIL_VIEW}
      title={t("Container details")}
      usePortal
      size={DrawerSize.SMALL}
      onClose={onClose}
      isOpen
      hasBackdrop={false}
    >
      <div className={Classes.DRAWER_BODY}>
        <HTMLTable compact striped className="AppDataTable" data-table="registry.search.result">
          <tbody>
            <tr>
              <td>{t("Name")}</td>
              <td data-field="Name">{searchResult.Name}</td>
            </tr>
            <tr>
              <td>{t("Tags")}</td>
              <td>{searchResult.Tag}</td>
            </tr>
            <tr>
              <td>{t("Stars")}</td>
              <td>{searchResult.Stars}</td>
            </tr>
          </tbody>
        </HTMLTable>
        <FormActions searchResult={searchResult} onClose={onClose} />
        <CodeEditor value={searchResult.Description} mode="markdown" withoutLineNumbers />
      </div>
    </Drawer>
  );
};
