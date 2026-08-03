import { FormGroup } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

import { AvatarLibrary } from "@/web-app/components/ai/AvatarLibrary";

export const AvatarLibraryPanel: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="AppSettingsForm" data-form="avatars">
      <FormGroup label={t("Avatar library")}>
        <AvatarLibrary mode="manage" />
      </FormGroup>
    </div>
  );
};
