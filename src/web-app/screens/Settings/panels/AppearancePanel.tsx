import { Button, Checkbox, ControlGroup, FormGroup, HTMLSelect, MenuItem } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { type ItemPredicate, type ItemRenderer, Select } from "@blueprintjs/select";
import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { ContainerEngine, type EngineThemePreference } from "@/env/Types";
import { createLogger } from "@/platform/logger";
import { useAppStore } from "@/web-app/stores/appStore";

const logger = createLogger("web.settings");

// Appearance settings: engine theme + the "show engine column" toggle, and the monospace font override.
export const AppearancePanel: React.FC = () => {
  const { t } = useTranslation();
  const userSettings = useAppStore((state) => state.userSettings);
  const setGlobalUserSettings = useAppStore((state) => state.setGlobalUserSettings);

  const onEngineThemeChange = useCallback(
    async (e: ChangeEvent<HTMLSelectElement>) => {
      await setGlobalUserSettings({
        engineTheme: e.currentTarget.value as EngineThemePreference,
      });
    },
    [setGlobalUserSettings],
  );
  const onShowEngineColumnChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      await setGlobalUserSettings({
        showEngineColumn: !!e.currentTarget.checked,
      });
    },
    [setGlobalUserSettings],
  );

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
        logger.error("Unable to enumerate system fonts", error);
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

  return (
    <>
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
    </>
  );
};
