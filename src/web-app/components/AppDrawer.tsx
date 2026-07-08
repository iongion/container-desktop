// components/AppDrawer.tsx — the shared drawer shell for every form drawer in the app.
//
// Blueprint's <Drawer> renders its header (icon + title + close X) internally with no slot for extra header
// buttons, so this wrapper hides the built-in header (no `title`, `isCloseButtonShown={false}`) and renders a
// custom one that REUSES Blueprint's own header classes (so styling is identical) but adds a save-icon button
// to the LEFT of the close X (X stays last) as an alternative submit. The save button is bound to the form via
// the native HTML `form={formId}` association, so it submits the (possibly react-hook-form) form even though
// it lives outside it. Form bodies put their primary submit button LAST; this header button is the shortcut.

import {
  Button,
  ButtonGroup,
  Classes,
  Drawer,
  type DrawerProps,
  Icon,
  type IconName,
  type MaybeElement,
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import classNames from "classnames";
import { useTranslation } from "react-i18next";

import "./AppDrawer.css";

export const APP_DRAWER_PORTAL_CLASS = "AppDrawerPortal";
export const APP_DRAWER_BACKDROP_CLASS = "AppDrawerBackdrop";

export interface AppDrawerProps {
  title: React.ReactNode;
  icon?: IconName | MaybeElement;
  onClose: () => void;
  isOpen?: boolean;
  // When set, the header shows a Save (alternative submit) button bound to the form element with this id, placed
  // to the LEFT of the close button. Omit it for drawers that have no form to submit.
  formId?: string;
  submitting?: boolean;
  submitDisabled?: boolean;
  submitIcon?: IconName | MaybeElement;
  submitTitle?: string;
  size?: DrawerProps["size"];
  position?: DrawerProps["position"];
  hasBackdrop?: boolean;
  usePortal?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export const AppDrawer: React.FC<AppDrawerProps> = ({
  title,
  icon,
  onClose,
  isOpen = true,
  formId,
  submitting,
  submitDisabled,
  submitIcon,
  submitTitle,
  size,
  position,
  hasBackdrop = false,
  usePortal = true,
  className,
  children,
}: AppDrawerProps) => {
  const { t } = useTranslation();
  return (
    <Drawer
      className={classNames("AppDrawer", className)}
      isCloseButtonShown={false}
      isOpen={isOpen}
      onClose={onClose}
      usePortal={usePortal}
      portalClassName={APP_DRAWER_PORTAL_CLASS}
      backdropClassName={APP_DRAWER_BACKDROP_CLASS}
      hasBackdrop={hasBackdrop}
      size={size}
      position={position}
    >
      <div className={classNames(Classes.DRAWER_HEADER, "AppDrawerHeader")}>
        {icon ? typeof icon === "string" ? <Icon icon={icon} /> : icon : null}
        <h4 className={classNames(Classes.HEADING, "AppDrawerHeaderTitle")}>{title}</h4>
        <ButtonGroup variant="minimal" className="AppDrawerHeaderActions">
          {formId ? (
            <Button
              type="submit"
              form={formId}
              icon={submitIcon ?? IconNames.FLOPPY_DISK}
              intent="success"
              disabled={submitting || submitDisabled}
              loading={submitting}
              title={submitTitle ?? t("Save")}
              aria-label={submitTitle ?? t("Save")}
            />
          ) : null}
          <Button icon={IconNames.CROSS} onClick={onClose} title={t("Close")} aria-label={t("Close")} />
        </ButtonGroup>
      </div>
      {children}
    </Drawer>
  );
};
