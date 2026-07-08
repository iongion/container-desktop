import { NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { InspectRawJson, InspectSummary } from "@/web-app/components/InspectSummary";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useRouteParams, useRouteSearch } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { SecretActionsMenu } from ".";
import "./InspectScreen.css";
import { buildSecretSummary } from "./inspectSummary";
import { getSecretCrumbs } from "./Navigation";
import { useSecret } from "./queries";

export interface ScreenProps extends AppScreenProps {}

export const ID = "secret.inspect";
export const Title = i18n.t("Secret Inspect");

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const { id } = useRouteParams<{ id: string }>();
  const { connId } = useRouteSearch<{ connId?: string }>();
  const primaryConnectionId = useAppStore((state) => state.currentConnector?.id || "");
  const connectionId = connId || primaryConnectionId;
  const secretQuery = useSecret(connectionId, id);
  const secret = secretQuery.data;

  if (!secret) {
    if (secretQuery.isLoading || secretQuery.isFetching) {
      return <ScreenLoader screen={ID} pending />;
    }
    return (
      <div className="AppScreen" data-screen={ID}>
        <NonIdealState
          icon={IconNames.WARNING_SIGN}
          title={t("There is no such secret")}
          description={<p>{t("The secret was not found")}</p>}
        />
      </div>
    );
  }
  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader
        withoutSearch
        withBack
        titleText={secret.Spec.Name}
        titleIcon={IconNames.KEY}
        breadcrumbs={getSecretCrumbs(secret.Spec.Name, connectionId)}
        rightContent={<SecretActionsMenu secret={secret} withoutCreate />}
      />
      <div className="AppScreenContent">
        <InspectSummary rows={buildSecretSummary(secret)} dataTable="secret.inspect-summary" />
        <InspectRawJson value={JSON.stringify(secret, null, 2)} />
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: "/screens/secrets/$id/inspect",
};
Screen.Metadata = {
  LeftIcon: IconNames.KEY,
  ExcludeFromSidebar: true,
};
