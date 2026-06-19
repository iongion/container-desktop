import { Icon, Intent } from "@blueprintjs/core";
import type { IconName } from "@blueprintjs/icons";
import React from "react";

import "./AppDataTableLink.css";

interface AppDataTableLinkProps {
  className?: string;
  fillCell?: boolean;
  href: string;
  iconName: IconName;
  intent?: Intent;
  text: string;
  title?: string;
}

export const AppDataTableLink = React.memo(
  ({ className, fillCell, href, iconName, intent = Intent.PRIMARY, text, title }: AppDataTableLinkProps) => (
    <a
      className={[
        "bp6-button",
        "bp6-minimal",
        "bp6-small",
        `bp6-intent-${intent}`,
        "AppDataTableLink",
        fillCell ? "AppDataTableLinkFillCell" : undefined,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      href={href}
      title={title}
    >
      <Icon icon={iconName} />
      <span className="bp6-button-text">{text}</span>
    </a>
  ),
);
