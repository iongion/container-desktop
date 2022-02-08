import React from "react";
import { NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

export const ScreenLoader: React.FC<{ screen: string; pending: boolean }> = ({ screen, pending }) => {
  const { t } = useTranslation();
  return (
    <div className="AppScreen" data-screen={screen}>
      {pending ? (
        <NonIdealState
          icon={IconNames.SEARCH}
          title={t("Loading")}
          description={<p>{t("Accessing detailed information")}</p>}
        />
      ) : (
        <NonIdealState
          icon={IconNames.WARNING_SIGN}
          title={t("There is no item")}
          description={<p>{t("The item was not found")}</p>}
        />
      )}
    </div>
  );
};
