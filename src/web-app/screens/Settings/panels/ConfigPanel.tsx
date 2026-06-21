import { Button, FormGroup, InputGroup } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { Application } from "@/container-client/Application";
import { useAppStore } from "@/web-app/stores/appStore";

// Configuration: where Container Desktop stores its settings/data on disk. Informational only — this is
// NOT the log output location (file logging lives under the Logging category). The Open button reveals
// the directory in the OS file manager (main resolves the path).
export const ConfigPanel: React.FC = () => {
  const { t } = useTranslation();
  const userSettings = useAppStore((state) => state.userSettings);
  const onOpenStorageFolder = useCallback(() => Application.getInstance().openStorageFolder(), []);

  return (
    <div className="AppSettingsForm" data-form="configuration">
      <FormGroup
        label={t("Storage path")}
        labelFor="userSettingsPath"
        helperText={t("Where Container Desktop stores its settings and data on this device.")}
      >
        <InputGroup
          id="userSettingsPath"
          value={userSettings.path}
          readOnly
          fill
          rightElement={
            <Button
              variant="minimal"
              icon={IconNames.FOLDER_OPEN}
              text={t("Open")}
              title={t("Open storage folder")}
              onClick={onOpenStorageFolder}
            />
          }
        />
      </FormGroup>
    </div>
  );
};
