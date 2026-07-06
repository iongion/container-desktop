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
  // Optional node rendered between the leading icon and the text — e.g. a status dot that must read as part
  // of the label (clickable with it), not a separate cell element.
  prefix?: React.ReactNode;
}

export const AppDataTableLink = React.memo(
  ({ className, fillCell, href, iconName, intent = Intent.PRIMARY, text, title, prefix }: AppDataTableLinkProps) => (
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
      {prefix}
      <span className="bp6-button-text">{text}</span>
    </a>
  ),
);
