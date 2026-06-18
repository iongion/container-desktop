import { Classes, DrawerSize, Position } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import type React from "react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import type { Connection } from "@/env/Types";
import { AppDrawer } from "@/web-app/components/AppDrawer";
import { ManageConnectionForm } from "./ManageConnectionForm";

import "./ManageConnectionDrawer.css";

export interface ManageConnectionDrawerProps {
  mode: "create" | "edit";
  connection?: Connection;
  onClose: () => void;
}

export const ManageConnectionDrawer: React.FC<ManageConnectionDrawerProps> = (props: ManageConnectionDrawerProps) => {
  const { t } = useTranslation();
  const formId = useId();
  return (
    <AppDrawer
      className="ManageConnectionDrawer"
      title={props.mode === "create" ? t("Create container host connection") : t("Manage container host connection")}
      icon={IconNames.PLUS}
      size={DrawerSize.SMALL}
      onClose={props.onClose}
      hasBackdrop={true}
      position={Position.RIGHT}
      formId={formId}
    >
      <div className={Classes.DRAWER_BODY}>
        <ManageConnectionForm {...props} formId={formId} />
      </div>
    </AppDrawer>
  );
};
