import { AnchorButton, Button, ButtonGroup, FormGroup, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { OnlineApi } from "@/container-client/Api.clients";
import { OperatingSystem } from "@/env/Types";
import { createLogger } from "@/platform/logger";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";

const logger = createLogger("web.settings");

// The Settings header action: shows the version-update check (Microsoft Store link on Windows, GitHub
// releases elsewhere) + a "Check now" button. This is a header action, distinct from the
// "check at startup" toggle in the Startup & behavior category.
export const VersionCheckWidget: React.FC = () => {
  const { t } = useTranslation();
  const osType = useAppStore((state) => state.osType);
  const [isChecking, setIsChecking] = useState(false);

  const onVersionCheck = useCallback(async () => {
    setIsChecking(true);
    try {
      const check = await new OnlineApi(import.meta.env.ONLINE_API).checkLatestVersion(osType);
      if (check.hasUpdate) {
        Notification.show({
          message: t("A newer version {{latest}} has been found", check),
          intent: Intent.PRIMARY,
        });
      } else {
        Notification.show({
          message: t("No new version detected"),
          intent: Intent.SUCCESS,
        });
      }
    } catch (error: any) {
      logger.error("Unable to check latest version", error);
      Notification.show({
        message: t("Unable to check latest version"),
        intent: Intent.DANGER,
      });
    }
    setIsChecking(false);
  }, [t, osType]);

  if (import.meta.env.TARGET === OperatingSystem.Windows) {
    return (
      <FormGroup
        inline
        label={t("Check for new versions")}
        data-target={import.meta.env.TARGET}
        className="AppSettingsFormVersionCheck AppSettingsHeaderVersionCheck"
        labelFor="checkLatestVersionNow"
      >
        <ButtonGroup className="AppSettingsFormVersionCheckActions">
          <AnchorButton
            className="AppSettingsFormVersionCheckStore"
            size="small"
            title={t("Check latest version")}
            href="https://apps.microsoft.com/detail/9mtg4qx6d3ks?mode=direct"
            target="_blank"
          />
          <Button
            id="checkLatestVersionNow"
            fill
            loading={isChecking}
            disabled={isChecking}
            intent={Intent.PRIMARY}
            size="small"
            text={t("Check now")}
            icon={IconNames.UPDATED}
            onClick={onVersionCheck}
          />
        </ButtonGroup>
      </FormGroup>
    );
  }

  return (
    <FormGroup
      inline
      label={t("Check for new versions")}
      data-target={import.meta.env.TARGET}
      className="AppSettingsFormVersionCheck AppSettingsHeaderVersionCheck"
      labelFor="checkLatestVersionNow"
    >
      <ButtonGroup fill className="AppSettingsFormVersionCheckActions">
        <AnchorButton
          size="small"
          variant="outlined"
          icon={IconNames.DOWNLOAD}
          text={t("Versions")}
          href="https://github.com/iongion/container-desktop/releases"
          target="_blank"
          rel="noopener noreferrer"
        />
        <Button
          id="checkLatestVersionNow"
          loading={isChecking}
          disabled={isChecking}
          intent={Intent.PRIMARY}
          size="small"
          text={t("Check now")}
          icon={IconNames.UPDATED}
          onClick={onVersionCheck}
        />
      </ButtonGroup>
    </FormGroup>
  );
};
