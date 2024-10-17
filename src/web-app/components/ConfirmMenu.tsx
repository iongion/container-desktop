import { Button, ButtonGroup, Intent, Menu, MenuItem, Popover, Position } from "@blueprintjs/core";
import { type IconName, IconNames } from "@blueprintjs/icons";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export type ConfirmMenuRemoveHandler = (tag: any, confirmed: boolean) => void;

export interface ConfirmMenuItemProps {
  icon?: IconName;
  tag?: any;
  text?: string;
  title?: string;
  intent?: Intent;
  disabled?: boolean;
  autoConfirm?: boolean;
  onConfirm?: (tag: any, e: any) => void;
  onCancel?: (tag: any, e: any) => void;
}
export const ConfirmMenuItem: React.FC<ConfirmMenuItemProps> = ({
  icon,
  tag,
  text,
  title,
  disabled,
  intent,
  onConfirm,
  onCancel,
}: ConfirmMenuItemProps) => {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState(false);
  const onTrigger = useCallback(
    (e) => {
      e.stopPropagation();
      e.preventDefault();
      setConfirm(!confirm);
      return false;
    },
    [confirm],
  );
  const onConfirmClick = useCallback(
    (e) => {
      if (onConfirm) {
        onConfirm(tag, e);
      }
    },
    [onConfirm, tag],
  );
  const onCancelClick = useCallback(
    (e) => {
      if (onCancel) {
        onCancel(tag, e);
      }
    },
    [onCancel, tag],
  );

  return confirm ? (
    <MenuItem
      text={t("Confirmed ?")}
      intent={Intent.NONE}
      onClick={onTrigger}
      className="ActionMenuItemConfirm"
      labelElement={
        <ButtonGroup>
          <Button disabled={disabled} minimal small text={t("Yes")} intent={Intent.DANGER} onClick={onConfirmClick} />
          <Button disabled={disabled} minimal small text={t("No")} intent={Intent.SUCCESS} onClick={onCancelClick} />
        </ButtonGroup>
      }
    />
  ) : (
    <MenuItem
      disabled={disabled}
      icon={icon || IconNames.TRASH}
      title={title}
      text={text || t("Remove")}
      intent={intent || Intent.DANGER}
      onClick={onTrigger}
    />
  );
};
export interface ConfirmMenuProps {
  disabled?: boolean;
  children?: any;
  title?: string;
  tag?: any;
  onConfirm: ConfirmMenuRemoveHandler;
}
export const ConfirmMenu: React.FC<ConfirmMenuProps> = ({
  disabled,
  tag,
  title,
  children,
  onConfirm,
}: ConfirmMenuProps) => {
  const popoverRef = useRef<any>(null);
  const onActionConfirm = useCallback(
    (e) => {
      if (popoverRef.current) {
        popoverRef.current.handleOverlayClose(e);
      }
      onConfirm(tag, true);
    },
    [onConfirm, tag],
  );
  const onActionCancel = useCallback(
    (e) => {
      if (popoverRef.current) {
        popoverRef.current.handleOverlayClose(e);
      }
      onConfirm(tag, false);
    },
    [onConfirm, tag],
  );
  const menuContent = (
    <Menu>
      {children}
      <ConfirmMenuItem
        tag={tag}
        title={title}
        disabled={disabled}
        onConfirm={onActionConfirm}
        onCancel={onActionCancel}
      />
    </Menu>
  );
  return (
    <Popover ref={popoverRef} usePortal hasBackdrop={false} content={menuContent} position={Position.BOTTOM_LEFT}>
      <Button minimal small icon={IconNames.MORE} />
    </Popover>
  );
};
