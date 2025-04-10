import { Icon } from "@blueprintjs/core";
import type { IconName } from "@blueprintjs/icons";
import * as ReactIcon from "@mdi/react";

import "./AppLabel.css";

export interface AppLabelProps {
  iconPath?: string;
  iconName?: IconName;
  text?: string;
}

export const AppLabel: React.FC<AppLabelProps> = ({ iconPath, iconName, text }: AppLabelProps) => {
  let content: React.ReactNode | null = null;
  if (iconPath) {
    content = <ReactIcon.Icon path={iconPath} size={0.75} />;
  } else if (iconName) {
    content = <Icon icon={iconName} />;
  }
  return (
    <div className="AppLabel">
      {content ? <div className="AppLabelIcon">{content}</div> : null}
      {text && <div className="AppLabelText">{text}</div>}
    </div>
  );
};
