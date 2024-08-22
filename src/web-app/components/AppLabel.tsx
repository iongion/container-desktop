import { Icon } from "@blueprintjs/core";
import { IconName } from "@blueprintjs/icons";
import * as ReactIcon from "@mdi/react";

import "./AppLabel.css";

export interface AppLabelProps {
  iconPath?: string;
  iconName?: IconName;
  text?: string;
}

export const AppLabel: React.FC<AppLabelProps> = ({ iconPath, iconName, text }: AppLabelProps) => {
  let content;
  if (iconPath) {
    content = <ReactIcon.Icon path={iconPath} size={0.75} />;
  } else if (iconName) {
    content = <Icon icon={iconName} />;
  }
  return (
    <div className="AppLabel">
      <div className="AppLabelIcon">{content}</div>
      {text && <div className="AppLabelText">{text}</div>}
    </div>
  );
};
