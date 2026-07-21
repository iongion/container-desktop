// Shared collapsible frame for generative-UI tool cards. Renders the standard .AICardHead (icon + title) as
// a single toggle button with a right-side chevron, and wraps the card body in a Blueprint Collapse. Cards
// start collapsed so the transcript stays scannable; expand state is local to each card instance (kept by
// its stable transcript id, so it survives streaming re-renders).
import { Collapse, Icon } from "@blueprintjs/core";
import { type IconName, IconNames } from "@blueprintjs/icons";
import { useState } from "react";

export interface AICardShellProps {
  title: string;
  icon?: IconName;
  children: React.ReactNode;
}

export const AICardShell: React.FC<AICardShellProps> = ({ title, icon = IconNames.DATABASE, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="AICard">
      <button type="button" className="AICardHead" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon icon={icon} size={12} />
        <span className="AICardTitle">{title}</span>
        <span className="AICardSpacer" />
        <Icon className="AICardChevron" icon={open ? IconNames.CHEVRON_UP : IconNames.CHEVRON_DOWN} size={14} />
      </button>
      <Collapse isOpen={open}>{children}</Collapse>
    </div>
  );
};
