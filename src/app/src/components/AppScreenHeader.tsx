import { useCallback } from "react";
import { Alignment, Button, InputGroup, Navbar, Icon } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import { useHistory } from "react-router-dom";

interface AppScreenHeaderProps {
  onSearch?: React.ChangeEventHandler<HTMLInputElement> | undefined;
  withoutSearch?: boolean;
  withBack?: boolean;
  titleText?: string;
  titleIcon?: any;
  rightContent?: React.ReactNode;
}

export const AppScreenHeader: React.FC<AppScreenHeaderProps> = ({
  onSearch,
  withBack,
  withoutSearch,
  titleText,
  titleIcon,
  rightContent
}) => {
  const { t } = useTranslation();
  const history = useHistory();
  const onGoBackClick = useCallback(() => {
    history.go(-1);
  }, [history]);
  const backButton = withBack ? (
    <Navbar.Group align={Alignment.LEFT}>
      <Navbar.Heading>
        <Button minimal title={t("Go back")} text={t("Back")} icon={IconNames.CHEVRON_LEFT} onClick={onGoBackClick} />
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
