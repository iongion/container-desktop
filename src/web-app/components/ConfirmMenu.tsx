import { Button, ButtonGroup, Intent, Menu, MenuItem, PopoverNext } from "@blueprintjs/core";
import { type IconName, IconNames } from "@blueprintjs/icons";
import { useCallback, useState } from "react";
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
          <Button
            disabled={disabled}
            variant="minimal"
            size="small"
            text={t("Yes")}
            intent={Intent.DANGER}
            onClick={onConfirmClick}
          />
          <Button
            disabled={disabled}
            variant="minimal"
            size="small"
            text={t("No")}
            intent={Intent.SUCCESS}
            onClick={onCancelClick}
          />
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
  // Notified whenever the popover opens/closes. The container list uses this to keep the (hover-gated) row
  // menu mounted while it's open, so moving the mouse toward a menu item doesn't tear the popover down.
  onOpenChange?: (open: boolean) => void;
}
export const ConfirmMenu: React.FC<ConfirmMenuProps> = ({
  disabled,
  tag,
  title,
  children,
  onConfirm,
  onOpenChange,
}: ConfirmMenuProps) => {
  // Controlled open state: PopoverNext (React 19 compatible) has no imperative
  // handleOverlayClose, so we close it explicitly when an action is taken.
  const [isOpen, setIsOpen] = useState(false);
  const changeOpen = useCallback(
    (next: boolean) => {
      setIsOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const onActionConfirm = useCallback(
    (_e) => {
      changeOpen(false);
      onConfirm(tag, true);
    },
    [changeOpen, onConfirm, tag],
  );
  const onActionCancel = useCallback(
    (_e) => {
      changeOpen(false);
      onConfirm(tag, false);
    },
    [changeOpen, onConfirm, tag],
  );
  const onOpen = useCallback(
    (e) => {
      e.stopPropagation();
      changeOpen(true);
    },
    [changeOpen],
  );
  const triggerButton = (
    <Button variant="minimal" size="small" icon={IconNames.MORE} onClick={isOpen ? undefined : onOpen} />
  );
  if (!isOpen) {
    return triggerButton;
  }
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
    <PopoverNext
      isOpen={isOpen}
      onInteraction={(nextOpenState) => changeOpen(nextOpenState)}
      usePortal
      hasBackdrop={false}
      content={menuContent}
      placement="bottom-start"
    >
      {triggerButton}
    </PopoverNext>
  );
};
