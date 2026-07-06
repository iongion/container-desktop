import { Button, ButtonGroup, Checkbox, FormGroup, HTMLSelect, InputGroup, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { type ChangeEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Application } from "@/container-client/Application";
import type { GlobalUserSettingsOptions, LoggingFileSettings } from "@/env/Types";
import {
  LOGGING_FILE_MAX_FILES,
  LOGGING_FILE_MAX_SIZE_MB,
  normalizeLoggingFileSettings,
} from "@/platform/logger/loggingSettings";
import { LOGGING_LEVELS } from "@/web-app/Environment";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";

// Logging: verbosity level + opt-in LOCAL file logging (rotated, size-capped, NEVER uploaded). The log
// file is owned by the main process; this panel persists the policy and nudges main to apply/open it. The
// file controls are always visible but disabled until "Write logs to a file" is ticked.
export const LoggingPanel: React.FC = () => {
  const { t } = useTranslation();
  const userSettings = useAppStore((state) => state.userSettings);
  const setGlobalUserSettings = useAppStore((state) => state.setGlobalUserSettings);
  const fileLogging = normalizeLoggingFileSettings(userSettings.logging.file);
  const enabled = fileLogging.enabled;

  // The log file lives under the app data dir, resolved in MAIN (NOT the settings "Storage path" shown in
  // the Configuration category). Ask main for its real, resolved location to display + open.
  const [logFilePath, setLogFilePath] = useState("");
  useEffect(() => {
    let active = true;
    Application.getInstance()
      .applyLogging()
      .then((result) => {
        if (active) {
          setLogFilePath(result.logFile);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const onLevelChange = useCallback(
    async (e: ChangeEvent<HTMLSelectElement>) => {
      const configuration: Partial<GlobalUserSettingsOptions> = { logging: { level: e.currentTarget.value } };
      await setGlobalUserSettings(configuration);
      // Re-apply in main so the file transport follows the new verbosity immediately.
      await Application.getInstance().applyLogging();
    },
    [setGlobalUserSettings],
  );

  // Persist a file-logging change, then nudge main (which owns the rotating file) to re-apply it.
  const applyFileLogging = useCallback(
    async (patch: Partial<LoggingFileSettings>) => {
      const file = normalizeLoggingFileSettings({ ...fileLogging, ...patch });
      await setGlobalUserSettings({ logging: { level: userSettings.logging.level, file } });
      const result = await Application.getInstance().applyLogging();
      setLogFilePath(result.logFile);
    },
    [fileLogging, setGlobalUserSettings, userSettings.logging.level],
  );

  const onFileEnabledChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => applyFileLogging({ enabled: !!e.currentTarget.checked }),
    [applyFileLogging],
  );
  const onMaxSizeChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => applyFileLogging({ maxSizeMb: Number(e.currentTarget.value) }),
    [applyFileLogging],
  );
  const onMaxFilesChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => applyFileLogging({ maxFiles: Number(e.currentTarget.value) }),
    [applyFileLogging],
  );
  // A missing file is NORMAL (it appears on the first write) → inform gently; an access failure is a real error.
  const notifyLogFileResult = useCallback(
    (result: { ok: boolean; reason?: string }) => {
      if (result.ok) {
        return;
      }
      if (result.reason === "missing") {
        Notification.show({
          message: t("No log file yet — turn on file logging and use the app to create it."),
          intent: Intent.PRIMARY,
        });
      } else {
        Notification.show({
          message: t("The log file could not be opened — check its permissions."),
          intent: Intent.DANGER,
        });
      }
    },
    [t],
  );
  const onOpenLogFile = useCallback(
    async () => notifyLogFileResult(await Application.getInstance().openLogFile()),
    [notifyLogFileResult],
  );
  const onRevealLogFile = useCallback(
    async () => notifyLogFileResult(await Application.getInstance().revealLogFile()),
    [notifyLogFileResult],
  );

  return (
    <div className="AppSettingsForm" data-form="logging">
      <FormGroup label={t("Level")} labelFor="loggingLevel">
        <HTMLSelect id="loggingLevel" value={userSettings.logging.level || "warn"} onChange={onLevelChange}>
          {LOGGING_LEVELS.map((level) => (
            <option key={`logging.${level}`} value={level}>
              {level}
            </option>
          ))}
        </HTMLSelect>
      </FormGroup>

      <FormGroup label={t("Log to file")} helperText={t("Logs are written only to this device — never uploaded.")}>
        <Checkbox
          id="loggingToFile"
          label={t("Write logs to a file")}
          checked={enabled}
          onChange={onFileEnabledChange}
        />
      </FormGroup>

      <div className="AppSettingsLoggingFileControls" data-enabled={enabled ? "yes" : "no"}>
        <FormGroup label={t("Max file size")} labelFor="loggingMaxSize">
          <HTMLSelect id="loggingMaxSize" disabled={!enabled} value={fileLogging.maxSizeMb} onChange={onMaxSizeChange}>
            {LOGGING_FILE_MAX_SIZE_MB.map((mb) => (
              <option key={mb} value={mb}>
                {mb} MB
              </option>
            ))}
          </HTMLSelect>
        </FormGroup>
        <FormGroup label={t("Files kept")} labelFor="loggingMaxFiles">
          <HTMLSelect id="loggingMaxFiles" disabled={!enabled} value={fileLogging.maxFiles} onChange={onMaxFilesChange}>
            {LOGGING_FILE_MAX_FILES.map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </HTMLSelect>
        </FormGroup>
      </div>

      {logFilePath ? (
        <FormGroup label={t("Log file")} labelFor="loggingFilePath">
          <InputGroup
            id="loggingFilePath"
            value={logFilePath}
            readOnly
            fill
            rightElement={
              <ButtonGroup>
                <Button
                  variant="minimal"
                  icon={IconNames.DOCUMENT_OPEN}
                  text={t("Read")}
                  title={t("Open log file")}
                  disabled={!enabled}
                  onClick={onOpenLogFile}
                />
                <Button
                  variant="minimal"
                  icon={IconNames.FOLDER_OPEN}
                  text={t("Open")}
                  title={t("Open logs folder")}
                  disabled={!enabled}
                  onClick={onRevealLogFile}
                />
              </ButtonGroup>
            }
          />
        </FormGroup>
      ) : null}
    </div>
  );
};
