import { Alignment, Button, ButtonGroup } from "@blueprintjs/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { PROJECT_VERSION } from "@/web-app/Environment";
import { useRouteSearch } from "@/web-app/Navigator";

import { SETTINGS_PANELS } from "./settingsCategories";
import { DEFAULT_SETTINGS_CATEGORY_ID, resolveSettingsCategoryId, SETTINGS_CATEGORIES } from "./settingsCategoryModel";
import { VersionCheckWidget } from "./VersionCheckWidget";

// Categorized settings: a left vertical category rail + the active category's panel, under the screen
// header that carries the version-check action. The active category is local UI state, seeded once from
// an optional `?category=` search param so other screens (e.g. the chat ModelPicker) can deep-link
// straight to a section like AI Assistant; absent/unknown values fall back to the default category.
export const SettingsLayout: React.FC = () => {
  const { t } = useTranslation();
  const search = useRouteSearch<{ category?: string }>();
  const requestedId = resolveSettingsCategoryId(search.category);
  const [activeId, setActiveId] = useState<string>(requestedId);
  useEffect(() => {
    setActiveId(requestedId);
  }, [requestedId]);
  const ActivePanel = SETTINGS_PANELS[activeId] ?? SETTINGS_PANELS[DEFAULT_SETTINGS_CATEGORY_ID];

  return (
    <>
      <AppScreenHeader withoutSearch rightContent={<VersionCheckWidget />}>
        <div className="AppScreenHeaderText">{PROJECT_VERSION}</div>
      </AppScreenHeader>
      <div className="AppScreenContent SettingsContent">
        <div className="SettingsRail">
          <ButtonGroup vertical>
            {SETTINGS_CATEGORIES.map((category) => (
              <Button
                key={category.id}
                className="SettingsRailItem"
                variant="minimal"
                alignText={Alignment.START}
                fill
                active={activeId === category.id}
                icon={category.icon}
                text={t(category.title)}
                onClick={() => setActiveId(category.id)}
                data-category={category.id}
              />
            ))}
          </ButtonGroup>
        </div>
        <div className="SettingsPanel" data-category={activeId}>
          <ActivePanel />
        </div>
      </div>
    </>
  );
};
