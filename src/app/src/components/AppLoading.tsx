import { useCallback } from "react";
import { AnchorButton, Button, ButtonGroup, Intent, ProgressBar } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
// project
import { useStoreActions, useStoreState } from "../domain/types";
import { pathTo } from "../Navigator";
// module
import "./AppLoading.css";

export interface AppLoadingProps {}

export const AppLoading: React.FC<AppLoadingProps> = () => {
  const { t } = useTranslation();
  const connect = useStoreActions((actions) => actions.connect);
  const running = useStoreState((state) => state.environment.running);
  const pending = useStoreState((state) => state.pending);
  const userConfiguration = useStoreState((state) => state.environment.userConfiguration);
  const onConnectClick = useCallback(
    async () => {
      await connect({ startApi: !!userConfiguration.autoStartApi });
    },
    [connect, userConfiguration]
  );
  const callToAction = !running ? (
    <ButtonGroup className="AppLoadingActions">
      <Button disabled={pending} fill text={t("Reconnect")} icon={IconNames.REFRESH} onClick={onConnectClick} />
      <AnchorButton
        href={pathTo("/screens/settings")}
        icon={IconNames.COG}
        text={t("Settings")}
        intent={Intent.PRIMARY}
      />
    </ButtonGroup>
  ) : null;
  const splashContent = pending ? <ProgressBar intent={Intent.PRIMARY} /> : callToAction;
  return (
    <div className="AppLoading">
      <div className="AppLoadingSplashContainer">
        <div className="AppLoadingSplashLogo"></div>
        <div className="AppLoadingSplashContent">
          {splashContent}
        </div>
      </div>
    </div>
  );
};
