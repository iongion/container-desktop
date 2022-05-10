import { useCallback } from "react";
import { Alignment, AnchorButton, Button, InputGroup, Navbar, Icon } from "@blueprintjs/core";
import { IconName, IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import { useHistory } from "react-router-dom";

interface AppScreenHeaderProps {
  onSearch?: React.ChangeEventHandler<HTMLInputElement> | undefined;
  withoutSearch?: boolean;
  withBack?: boolean;
  titleText?: string;
  titleIcon?: any;
  rightContent?: React.ReactNode;
  listRoutePath?: string;
  listRouteIcon?: IconName;
}

export const AppScreenHeader: React.FC<AppScreenHeaderProps> = ({
  onSearch,
  withBack,
  withoutSearch,
  titleText,
  titleIcon,
  rightContent,
  listRoutePath,
  listRouteIcon
}) => {
  const { t } = useTranslation();
  const history = useHistory();
  const onGoBackClick = useCallback(() => {
    history.go(-1);
  }, [history]);
  const withList = !!listRoutePath;
  const backButton = withBack ? (
    <Navbar.Group align={Alignment.LEFT}>
      <Navbar.Heading>
        <Button minimal title={t("Go back")} icon={IconNames.CHEVRON_LEFT} onClick={onGoBackClick} />
        {withList && <AnchorButton minimal icon={listRouteIcon || IconNames.LIST} href={listRoutePath} title={t("Jump to list")} />}
      </Navbar.Heading>
    </Navbar.Group>
  ) : null;
  const searchWidget = withoutSearch ? null : (
    <Navbar.Group>
      <InputGroup
        leftIcon={IconNames.SEARCH}
        type="search"
        placeholder={t("Type to begin search")}
        onChange={onSearch}
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
        {backButton}
        {searchWidget}
        <div className="NavbarCenter" data-with-back="yes">
          <div className="NavbarCenterContent">{titleWidget}</div>
        </div>
        {rightWidget}
      </Navbar>
    </div>
  );
};
