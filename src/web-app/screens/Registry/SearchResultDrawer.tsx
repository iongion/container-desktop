import { Button, ButtonGroup, Classes, DrawerSize, HTMLTable, Intent, ProgressBar } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RegistrySearchResult } from "@/env/Types";
import { AppDrawer } from "@/web-app/components/AppDrawer";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import { ConnectionSelect } from "@/web-app/components/ConnectionSelect";
import { Notification } from "@/web-app/Notification";
import { usePullFromRegistry } from "./queries";
import "./SearchResultDrawer.css";
import { createLogger } from "@/logger";

const logger = createLogger("web.registry");

export interface SearchResultDrawerProps {
  onClose: () => void;
  searchResult: RegistrySearchResult;
}
export const SearchResultDrawer: React.FC<SearchResultDrawerProps> = ({
  onClose,
  searchResult,
}: SearchResultDrawerProps) => {
  const { t } = useTranslation();
  const formId = useId();
  const [connectionId, setConnectionId] = useState("");
  const pullFromRegistry = usePullFromRegistry(connectionId);
  const pending = pullFromRegistry.isPending;
  const onPull = useCallback(async () => {
    try {
      const result = await pullFromRegistry.mutateAsync({
        image: searchResult.Name,
      });
      if (result.success) {
        Notification.show({
          message: t("Pull completed successfully"),
          intent: Intent.SUCCESS,
        });
        onClose();
      } else {
        Notification.show({
          message: t("Pull failed - check the logs"),
          intent: Intent.DANGER,
        });
      }
    } catch (error: any) {
      logger.error("Error while performing image pull", error);
      Notification.show({
        message: t("Pull failed - check the logs"),
        intent: Intent.DANGER,
      });
    }
  }, [onClose, pullFromRegistry, searchResult, t]);
  return (
    <AppDrawer
      className="AppDrawerRegistrySearchResults"
      icon={IconNames.LIST_DETAIL_VIEW}
      title={t("Container details")}
      size={DrawerSize.SMALL}
      onClose={onClose}
      formId={formId}
      submitting={pending}
      submitIcon={IconNames.DOWNLOAD}
      submitTitle={t("Pull latest")}
    >
      <div className={Classes.DRAWER_BODY}>
        <form
          id={formId}
          className={Classes.DIALOG_BODY}
          onSubmit={(e) => {
            e.preventDefault();
            onPull();
          }}
        >
          <ConnectionSelect value={connectionId} onChange={setConnectionId} disabled={pending} />
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
          <CodeEditor value={searchResult.Description} mode="markdown" withoutLineNumbers />
          <div className="AppDrawerPendingIndicator">{pending && <ProgressBar intent={Intent.SUCCESS} />}</div>
          <ButtonGroup fill>
            <Button
              type="submit"
              disabled={pending}
              intent={Intent.PRIMARY}
              icon={IconNames.DOWNLOAD}
              title={t("Click to launch retrieval")}
              text={t("Pull latest")}
            />
          </ButtonGroup>
        </form>
      </div>
    </AppDrawer>
  );
};
