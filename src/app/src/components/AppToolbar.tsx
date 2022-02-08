import { Navbar, NavbarGroup, Button, Alignment, ButtonGroup } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";

export const AppToolbar = () => {
  return (
    <Navbar>
      <NavbarGroup align={Alignment.LEFT}>
        <ButtonGroup>
          <Button icon={IconNames.CLIPBOARD} />
          <Button icon={IconNames.CUT} />
          <Button icon={IconNames.PAPERCLIP} />
        </ButtonGroup>
      </NavbarGroup>
    </Navbar>
  );
};
