import { NonIdealState, Spinner } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import React from "react";
import { useTranslation } from "react-i18next";

export interface ScreenLoaderProps {
  screen: string;
  pending: boolean;
  title?: string;
  description?: string;
}

export const ScreenLoader: React.FC<ScreenLoaderProps> = ({ screen, pending, title, description }: ScreenLoaderProps) => {
  const { t } = useTranslation();
  return (
    <div className="AppScreen" data-screen={screen}>
      {pending ? (
        <NonIdealState title={<Spinner size={48} />} description={<p>{description || t("Accessing detailed information")}</p>} />
      ) : (
        <NonIdealState icon={IconNames.WARNING_SIGN} title={title || t("There is no item")} description={<p>{description || t("The item was not found")}</p>} />
      )}
    </div>
  );
};
