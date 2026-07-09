import { Alignment, AnchorButton, ButtonGroup } from "@blueprintjs/core";
import type { IconName } from "@blueprintjs/icons";
import type { ReactNode } from "react";

import "./ResourceSectionRail.css";

export interface ResourceSectionRailItem {
  // Stable id — matched against the host screen's id to highlight the current section.
  id: string;
  // Already-translated label.
  label: string;
  icon: IconName;
  // Hash route this section navigates to.
  href: string;
}

interface ResourceSectionRailProps {
  items: ResourceSectionRailItem[];
  // Id of the active section (the host screen's ID).
  activeId: string;
  // Screen id for CSS/test hooks, e.g. "image.inspect".
  dataScreen?: string;
  // The active section's content pane (rendered to the right of the rail).
  children?: ReactNode;
}

// A resource DETAIL section switcher — the left vertical rail idiom of the Inspect tabs (InspectTabs.tsx),
// but each section is a separate ROUTE, so items are AnchorButton links (not local state). The active section
// is highlighted; its screen renders to the right. Recedes on --app-chrome, like the Settings category rail.
export function ResourceSectionRail({ items, activeId, dataScreen, children }: ResourceSectionRailProps) {
  return (
    <div className="ResourceDetailLayout" data-screen={dataScreen}>
      <div className="ResourceSectionRail">
        <ButtonGroup vertical>
          {items.map((item) => (
            <AnchorButton
              key={item.id}
              className="ResourceSectionRailItem"
              variant="minimal"
              alignText={Alignment.START}
              fill
              active={activeId === item.id}
              icon={item.icon}
              href={item.href}
              data-tab={item.id}
              text={item.label}
            />
          ))}
        </ButtonGroup>
      </div>
      {children}
    </div>
  );
}
