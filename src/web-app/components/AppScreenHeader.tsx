import { Alignment, AnchorButton, Button, Icon, InputGroup, Navbar } from "@blueprintjs/core";
import { type IconName, IconNames } from "@blueprintjs/icons";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { type AppBreadcrumb, AppBreadcrumbs } from "@/web-app/components/AppBreadcrumbs";

import "./AppScreenHeader.css";

interface AppScreenHeaderProps {
  searchTerm?: string;
  onSearch?: React.ChangeEventHandler<HTMLInputElement> | undefined;
  onSearchTrigger?:
    | (((event: React.MouseEvent<HTMLElement, MouseEvent>) => void) & React.MouseEventHandler<HTMLButtonElement>)
    | undefined;
  withoutSearch?: boolean;
  withSearchTrigger?: boolean;
  withBack?: boolean;
  leftText?: string;
  titleText?: string;
  titleIcon?: any;
  leftContent?: React.ReactNode;
  rightContent?: any; // React.ReactNode;
  centerContent?: React.ReactNode;
  // Canonical trail for nested screens. When present, it renders left (after the back chevron) and takes
  // over the title's role — the center title and the redundant "jump to list" icon are suppressed.
  breadcrumbs?: AppBreadcrumb[];
  listRoutePath?: string;
  listRouteIcon?: IconName;
  children?: React.ReactNode;
}

export const AppScreenHeader: React.FC<AppScreenHeaderProps> = ({
  searchTerm,
  onSearch,
  withBack,
  withSearchTrigger,
  withoutSearch,
  onSearchTrigger,
  leftText,
  titleText,
  titleIcon,
  rightContent,
  centerContent,
  breadcrumbs,
  listRoutePath,
  listRouteIcon,
  children,
}: AppScreenHeaderProps) => {
  const { t } = useTranslation();
  const onSearchKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter") {
        if (onSearchTrigger) {
          onSearchTrigger(e as any);
        }
      }
    },
    [onSearchTrigger],
  );
  const onGoBackClick = useCallback(() => {
    history.back();
  }, []);
  // A non-empty trail takes over the title's role: the root crumb already links to the list, so the
  // separate "jump to list" icon and the center title are both suppressed while breadcrumbs are shown.
  const withBreadcrumbs = !!breadcrumbs && breadcrumbs.length > 0;
  const withList = !!listRoutePath && !withBreadcrumbs;
  const backButton = withBack ? (
    <Navbar.Group align={Alignment.START}>
      <Navbar.Heading>
        <Button variant="minimal" title={t("Go back")} icon={IconNames.CHEVRON_LEFT} onClick={onGoBackClick} />
        {withList && (
          <AnchorButton
            variant="minimal"
            icon={listRouteIcon || IconNames.LIST}
            href={listRoutePath}
            title={t("Jump to list")}
          />
        )}
      </Navbar.Heading>
    </Navbar.Group>
  ) : null;
  const searchWidget = withoutSearch ? null : (
    <Navbar.Group>
      <InputGroup
        value={searchTerm || ""}
        leftIcon={IconNames.SEARCH}
        type="search"
        placeholder={t("Type a search term")}
        onChange={onSearch}
        onKeyDown={onSearchKeyDown}
        rightElement={
          withSearchTrigger ? (
            <Button
              variant="minimal"
              text={t("Search")}
              onClick={onSearchTrigger}
              className="SearchButtonTrigger"
              disabled={searchTerm === undefined || searchTerm === ""}
            />
          ) : undefined
        }
      />
    </Navbar.Group>
  );
  let titleWidget: React.ReactNode | null = null;
  if (titleText) {
    titleWidget = (
      <>
        <Icon icon={titleIcon} />
        &nbsp;
        <span title={titleText}>{titleText}</span>
      </>
    );
  }
  let rightWidget: React.ReactNode | null = null;
  if (rightContent) {
    rightWidget = <Navbar.Group align={Alignment.END}>{rightContent}</Navbar.Group>;
  }
  return (
    <div className="AppScreenHeader">
      <Navbar>
        <div className="NavbarLeft">
          {backButton}
          {withBreadcrumbs && breadcrumbs ? <AppBreadcrumbs items={breadcrumbs} /> : null}
          {searchWidget}
          {children}
        </div>
        <div className="NavbarCenter" data-with-back="yes">
          <div className="NavbarCenterContent">{centerContent ?? (withBreadcrumbs ? null : titleWidget)}</div>
        </div>
        {rightWidget}
      </Navbar>
    </div>
  );
};
