import { Alignment, AnchorButton, Button, Icon, InputGroup, Navbar } from "@blueprintjs/core";
import { IconName, IconNames } from "@blueprintjs/icons";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useHistory } from "react-router-dom";

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
  listRoutePath,
  listRouteIcon,
  children
}: AppScreenHeaderProps) => {
  const { t } = useTranslation();
  const history = useHistory();
  const onSearchKeyPress = useCallback(
    (e) => {
      if (e.key === "Enter") {
        if (onSearchTrigger) {
          onSearchTrigger(e as any);
        }
      }
    },
    [onSearchTrigger]
  );
  const onGoBackClick = useCallback(() => {
    history.go(-1);
  }, [history]);
  const withList = !!listRoutePath;
  const backButton = withBack ? (
    <Navbar.Group align={Alignment.LEFT}>
      <Navbar.Heading>
        <Button minimal title={t("Go back")} icon={IconNames.CHEVRON_LEFT} onClick={onGoBackClick} />
        {withList && (
          <AnchorButton minimal icon={listRouteIcon || IconNames.LIST} href={listRoutePath} title={t("Jump to list")} />
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
        onKeyPress={onSearchKeyPress}
        rightElement={
          withSearchTrigger ? (
            <Button
              minimal
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
  let titleWidget;
  if (titleText) {
    titleWidget = (
      <>
        <Icon icon={titleIcon} />
        &nbsp;
        <span title={titleText}>{titleText}</span>
      </>
    );
  }
  let rightWidget;
  if (rightContent) {
    rightWidget = <Navbar.Group align={Alignment.RIGHT}>{rightContent}</Navbar.Group>;
  }
  return (
    <div className="AppScreenHeader">
      <Navbar>
        <div className="NavbarLeft">
          {backButton}
          {searchWidget}
          {children}
        </div>
        <div className="NavbarCenter" data-with-back="yes">
          <div className="NavbarCenterContent">{titleWidget}</div>
        </div>
        {rightWidget}
      </Navbar>
    </div>
  );
};
