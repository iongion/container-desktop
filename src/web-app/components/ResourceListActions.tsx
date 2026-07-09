import { AnchorButton, Button, ButtonGroup, type ButtonProps, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import type React from "react";
import { useTranslation } from "react-i18next";

import "./ResourceListActions.css";

export interface ResourceListPrimaryAction {
  className?: string;
  disabled?: boolean;
  href?: string;
  icon?: ButtonProps["icon"];
  loading?: boolean;
  onClick?: React.MouseEventHandler<HTMLElement>;
  text: string;
  title?: string;
  intent?: Intent;
}

interface ResourceListActionsProps {
  actions?: ResourceListPrimaryAction | ResourceListPrimaryAction[];
  className?: string;
  navigation?: React.ReactNode;
  onReload: () => void;
  reloadDisabled?: boolean;
  reloadLoading?: boolean;
  reloadTitle?: string;
  utilityActions?: React.ReactNode;
  utilityActionsPlacement?: "before-reload" | "after-reload";
}

export const ResourceListActions: React.FC<ResourceListActionsProps> = ({
  actions,
  className,
  navigation,
  onReload,
  reloadDisabled,
  reloadLoading,
  reloadTitle,
  utilityActions,
  utilityActionsPlacement = "after-reload",
}: ResourceListActionsProps) => {
  const { t } = useTranslation();
  const items = Array.isArray(actions) ? actions : actions ? [actions] : [];
  return (
    <div className={["ResourceListActions", className].filter(Boolean).join(" ")}>
      {items.map((action) =>
        action.href ? (
          <AnchorButton
            key={action.text}
            className={["ResourceListActionButton", action.className].filter(Boolean).join(" ")}
            disabled={action.disabled}
            href={action.disabled ? undefined : action.href}
            icon={action.icon}
            intent={action.intent ?? Intent.SUCCESS}
            text={action.text}
            title={action.title}
          />
        ) : (
          <Button
            key={action.text}
            className={["ResourceListActionButton", action.className].filter(Boolean).join(" ")}
            disabled={action.disabled}
            icon={action.icon}
            intent={action.intent ?? Intent.SUCCESS}
            loading={action.loading}
            onClick={action.onClick}
            text={action.text}
            title={action.title}
          />
        ),
      )}
      {navigation ? <div className="ResourceListActionsNavigation">{navigation}</div> : null}
      <ButtonGroup className="ResourceListUtilityActions">
        {utilityActionsPlacement === "before-reload" ? utilityActions : null}
        <Button
          className="ResourceListActionsReload"
          disabled={reloadDisabled}
          icon={IconNames.REFRESH}
          loading={reloadLoading}
          onClick={onReload}
          title={reloadTitle ?? t("Reload current screen")}
          variant="minimal"
        />
        {utilityActionsPlacement === "after-reload" ? utilityActions : null}
      </ButtonGroup>
    </div>
  );
};
