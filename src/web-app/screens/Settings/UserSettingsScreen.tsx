import {
  AnchorButton,
  Button,
  ButtonGroup,
  Checkbox,
  ControlGroup,
  FormGroup,
  HTMLSelect,
  Icon,
  Intent,
  MenuItem,
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { type ItemPredicate, type ItemRenderer, Select } from "@blueprintjs/select";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { OnlineApi } from "@/container-client/Api.clients";
import { Application } from "@/container-client/Application";
import {
  ContainerEngine,
  type EngineThemePreference,
  type GlobalUserSettingsOptions,
  OperatingSystem,
} from "@/env/Types";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { LOGGING_LEVELS, PROJECT_VERSION } from "@/web-app/Environment";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import "./UserSettingsScreen.css";

// Screen

interface ScreenProps extends AppScreenProps {}

export const ID = "settings-settings";
export const View = "user-settings";
export const Title = "Settings";

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const [isChecking, setIsChecking] = useState(false);
  const userSettings = useAppStore((state) => state.userSettings);
  const setGlobalUserSettings = useAppStore((state) => state.setGlobalUserSettings);
  const osType = useAppStore((state) => state.osType);

  const onMinimizeToSystemTray = useCallback(
    async (e) => {
      await setGlobalUserSettings({
        minimizeToSystemTray: !!e.currentTarget.checked,
      });
    },
    [setGlobalUserSettings],
  );
  const onCheckLatestVersion = useCallback(
    async (e) => {
      await setGlobalUserSettings({
        checkLatestVersion: !!e.currentTarget.checked,
      });
    },
    [setGlobalUserSettings],
  );
  const onAutoReconnect = useCallback(
    async (e) => {
      await setGlobalUserSettings({
        reconnect: { ...userSettings.reconnect, enabled: !!e.currentTarget.checked },
      });
    },
    [setGlobalUserSettings, userSettings.reconnect],
  );
  const onLoggingLevelChange = useCallback(
    async (e) => {
      const configuration: Partial<GlobalUserSettingsOptions> = {};
      configuration.logging = {
        level: e.currentTarget.value,
      };
      await setGlobalUserSettings(configuration);
    },
    [setGlobalUserSettings],
  );
  const onEngineThemeChange = useCallback(
    async (e) => {
      await setGlobalUserSettings({
        engineTheme: e.currentTarget.value as EngineThemePreference,
      });
    },
    [setGlobalUserSettings],
  );
  const onShowEngineColumnChange = useCallback(
    async (e) => {
      await setGlobalUserSettings({
        showEngineColumn: !!e.currentTarget.checked,
      });
    },
    [setGlobalUserSettings],
  );
  const onToggleInspectorClick = useCallback(async (e) => {
    const instance = Application.getInstance();
    await instance.openDevTools();
  }, []);
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
      console.error("Unable to check latest version", error);
      Notification.show({
        message: t("Unable to check latest version"),
        intent: Intent.DANGER,
      });
    }
    setIsChecking(false);
  }, [t, osType]);

  // Monospace font override. Enumerating installed fonts is explicitly wanted here so users can
  // pick one they have; the bundled JetBrains Mono always remains the fallback.
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const query = (window as any).queryLocalFonts;
        if (typeof query === "function") {
          const fonts = await query();
          const families = Array.from(new Set(fonts.map((f: any) => f.family))).sort() as string[];
          setSystemFonts(families);
        }
      } catch (error: any) {
        console.error("Unable to enumerate system fonts", error);
      }
    })();
  }, []);
  const onFontChange = useCallback(
    async (patch: { family?: string; size?: number; weight?: number }) => {
      await setGlobalUserSettings({ font: { ...userSettings.font, ...patch } });
    },
    [setGlobalUserSettings, userSettings.font],
  );
  // Font family uses a DOM-based, filterable Blueprint Select (not a native <select>): a 250+ item
  // native popup loses its pointer grab mid scrollbar-drag on Wayland, and this lets the user type
  // to filter. "" = the bundled JetBrains Mono.
  const fontFamilyItems = useMemo<string[]>(() => ["", ...systemFonts], [systemFonts]);
  const fontFamilyLabel = (family: string) => family || t("JetBrains Mono (bundled)");
  const renderFontFamily: ItemRenderer<string> = (family, { handleClick, handleFocus, modifiers }) => {
    if (!modifiers.matchesPredicate) {
      return null;
    }
    return (
      <MenuItem
        key={family || "__bundled__"}
        active={modifiers.active}
        roleStructure="listoption"
        text={fontFamilyLabel(family)}
        onClick={handleClick}
        onFocus={handleFocus}
      />
    );
  };
  const filterFontFamily: ItemPredicate<string> = (query, family) =>
    fontFamilyLabel(family).toLowerCase().includes(query.toLowerCase());

  const versionCheckWidget =
    import.meta.env.TARGET === OperatingSystem.Windows ? (
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
    ) : (
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

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader withoutSearch rightContent={versionCheckWidget}>
        <div className="AppScreenHeaderText">{PROJECT_VERSION}</div>
      </AppScreenHeader>
      <div className="AppScreenContent">
        <div className="AppSettingsForm" data-form="flags">
          <FormGroup className="AppSettingsFeaturesToggles">
            <ControlGroup>
              <Checkbox
                id="minimizeToSystemTray"
                label={t("Minimize to System Tray when closing")}
                checked={!!userSettings.minimizeToSystemTray}
                onChange={onMinimizeToSystemTray}
              />
            </ControlGroup>
            <ControlGroup>
              <Checkbox
                id="checkLatestVersion"
                label={t("Automatically check for new version at startup")}
                checked={!!userSettings.checkLatestVersion}
                onChange={onCheckLatestVersion}
              />
            </ControlGroup>
            <ControlGroup>
              <Checkbox
                id="autoReconnect"
                label={t("Automatically reconnect dropped connections")}
                checked={userSettings.reconnect?.enabled ?? true}
                onChange={onAutoReconnect}
              />
            </ControlGroup>
          </FormGroup>
        </div>
        <div className="AppSettingsForm" data-form="appearance">
          <FormGroup label={t("Appearance")} labelFor="engineTheme">
            <ControlGroup className="AppSettingsAppearanceControls">
              <HTMLSelect
                id="engineTheme"
                title={t("Engine theme")}
                // Apple Container is an engine, not a selectable theme — keep the value on a valid
                // option so a stale stored "container" preference displays as "auto" (it resolves to
                // the unified theme anyway, see engineTheme.ts).
                value={
                  ["auto", "unified", ContainerEngine.PODMAN, ContainerEngine.DOCKER].includes(userSettings.engineTheme)
                    ? userSettings.engineTheme
                    : "auto"
                }
                onChange={onEngineThemeChange}
              >
                <option value="auto">{t("Automatic engine theme")}</option>
                <option value="unified">{t("Teal")}</option>
                <option value={ContainerEngine.PODMAN}>{t("Amethyst")}</option>
                <option value={ContainerEngine.DOCKER}>{t("Navy")}</option>
              </HTMLSelect>
              <Checkbox
                id="showEngineColumn"
                label={t("Show engine column in resource lists")}
                checked={!!userSettings.showEngineColumn}
                onChange={onShowEngineColumnChange}
              />
            </ControlGroup>
          </FormGroup>
        </div>
        <div className="AppSettingsForm" data-form="font">
          <FormGroup label={t("Monospace font")} labelFor="fontFamily" className="AppSettingsFontForm">
            <ControlGroup>
              <Select<string>
                className="AppSettingsFontFamily"
                items={fontFamilyItems}
                itemRenderer={renderFontFamily}
                itemPredicate={filterFontFamily}
                onItemSelect={(family) => onFontChange({ family })}
                activeItem={userSettings.font?.family || ""}
                popoverProps={{ minimal: true, popoverClassName: "AppMonospaceFontPopover" }}
                inputProps={{ placeholder: t("Filter fonts…") }}
              >
                <Button
                  id="fontFamily"
                  title={t("Font family")}
                  text={fontFamilyLabel(userSettings.font?.family || "")}
                  endIcon={IconNames.CARET_DOWN}
                  style={{ minWidth: 200, justifyContent: "space-between" }}
                />
              </Select>
              <HTMLSelect
                id="fontSize"
                title={t("Font size")}
                value={userSettings.font?.size || ""}
                onChange={(e) => onFontChange({ size: Number(e.currentTarget.value) || 0 })}
              >
                <option value="">{t("Size")}</option>
                {[10, 11, 12, 13, 14, 16, 18].map((size) => (
                  <option key={size} value={size}>
                    {size}px
                  </option>
                ))}
              </HTMLSelect>
              <HTMLSelect
                id="fontWeight"
                title={t("Font weight")}
                value={userSettings.font?.weight || ""}
                onChange={(e) => onFontChange({ weight: Number(e.currentTarget.value) || 0 })}
              >
                <option value="">{t("Weight")}</option>
                <option value="300">{t("Light")}</option>
                <option value="400">{t("Regular")}</option>
                <option value="500">{t("Medium")}</option>
                <option value="600">{t("SemiBold")}</option>
                <option value="700">{t("Bold")}</option>
              </HTMLSelect>
              <Button
                icon={IconNames.RESET}
                title={t("Reset to bundled font")}
                onClick={() => onFontChange({ family: "", size: 0, weight: 0 })}
              />
            </ControlGroup>
          </FormGroup>
        </div>
        <div className="AppSettingsForm" data-form="logging">
          <FormGroup label={t("Configuration and logging")} labelFor="userSettingsPath">
            <div className="AppSettingUserConfigurationPath">
              <Icon icon={IconNames.INFO_SIGN} />
              <strong>{t("Storage path")}</strong>
              <input id="userSettingsPath" name="userSettingsPath" type="text" value={userSettings.path} readOnly />
            </div>
          </FormGroup>
          <div className="AppSettingsFormLoggingLevel">
            <FormGroup label={t("Level")} labelFor="loggingLevel">
              <ControlGroup>
                <HTMLSelect
                  id="loggingLevel"
                  value={userSettings.logging.level || "error"}
                  onChange={onLoggingLevelChange}
                >
                  {LOGGING_LEVELS.map((level) => {
                    const key = `logging.${level}`;
                    return (
                      <option key={key} value={level}>
                        {level}
                      </option>
                    );
                  })}
                </HTMLSelect>
              </ControlGroup>
            </FormGroup>
            <FormGroup label={t("Debugging")} labelFor="loggingLevel">
              <ControlGroup>
                <Button icon={IconNames.PANEL_TABLE} text={t("Toggle inspector")} onClick={onToggleInspectorClick} />
              </ControlGroup>
            </FormGroup>
          </div>
        </div>
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: `/screens/settings/${View}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.COG,
  ExcludeFromSidebar: true,
};
