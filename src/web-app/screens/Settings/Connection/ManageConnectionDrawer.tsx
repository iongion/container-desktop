import { Classes, Drawer, DrawerSize, Position } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import type React from "react";
import { useTranslation } from "react-i18next";

import type { Connection } from "@/env/Types";
import { ManageConnectionForm } from "./ManageConnectionForm";

import "./ManageConnectionDrawer.css";

export interface ManageConnectionDrawerProps {
  mode: "create" | "edit";
  connection?: Connection;
  onClose: () => void;
}

export const ManageConnectionDrawer: React.FC<ManageConnectionDrawerProps> = (props: ManageConnectionDrawerProps) => {
  const { t } = useTranslation();
  return (
    <Drawer
      className="AppDrawer ManageConnectionDrawer"
      title={props.mode === "create" ? t("Create container host connection") : t("Manage container host connection")}
      icon={IconNames.PLUS}
      usePortal
      size={DrawerSize.SMALL}
      onClose={props.onClose}
      isOpen
      hasBackdrop={true}
      position={props.mode === "create" ? Position.LEFT : Position.RIGHT}
    >
      <div className={Classes.DRAWER_BODY}>
        <ManageConnectionForm {...props} />
      </div>
    </Drawer>
  );
};
