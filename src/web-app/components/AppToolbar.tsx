import { Alignment, Button, ButtonGroup, Navbar, NavbarGroup } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";

export const AppToolbar = () => {
  return (
    <Navbar>
      <NavbarGroup align={Alignment.START}>
        <ButtonGroup>
          <Button icon={IconNames.CLIPBOARD} />
          <Button icon={IconNames.CUT} />
          <Button icon={IconNames.PAPERCLIP} />
        </ButtonGroup>
      </NavbarGroup>
    </Navbar>
  );
};
