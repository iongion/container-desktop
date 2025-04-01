import { NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "wouter";

import type { Secret } from "@/env/Types";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import { useStoreActions } from "@/web-app/domain/types";

import { SecretActionsMenu } from ".";
import "./InspectScreen.css";

export interface ScreenProps extends AppScreenProps {}

export const ID = "secret.inspect";
export const Title = "Secret Inspect";

export const Screen: AppScreen<ScreenProps> = () => {
  const [secret, setSecret] = useState<Secret>();
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const secretFetch = useStoreActions((actions) => actions.secret.secretFetch);

  useEffect(() => {
    (async () => {
      const secret = await secretFetch({
        Id: id as any,
      });
      setSecret(secret);
    })();
  }, [secretFetch, id]);

  if (!secret) {
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
        rightContent={<SecretActionsMenu secret={secret} withoutCreate />}
      />
      <div className="AppScreenContent">
        <CodeEditor value={JSON.stringify(secret, null, 2)} />
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: "/screens/secrets/:id/inspect",
};
Screen.Metadata = {
  LeftIcon: IconNames.KEY,
  ExcludeFromSidebar: true,
};
