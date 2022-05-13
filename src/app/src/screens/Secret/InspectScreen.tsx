import { useEffect, useState } from "react";
import { NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

// project
import { AppScreenProps, AppScreen } from "../../Types";
import { AppScreenHeader } from "../../components/AppScreenHeader";
import { CodeEditor } from "../../components/CodeEditor";
import { useStoreActions } from "../../domain/types";

import { Secret } from "../../Types.container-app";
// module
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
        Id: id
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
        titleText={secret.ID}
        titleIcon={IconNames.BOX}
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
  Path: `/screens/secrets/:id/inspect`
};
Screen.Metadata = {
  LeftIcon: IconNames.KEY,
  ExcludeFromSidebar: true
};
