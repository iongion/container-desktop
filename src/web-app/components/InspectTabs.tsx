import { Alignment, Button, ButtonGroup, Tag } from "@blueprintjs/core";
import type { IconName } from "@blueprintjs/icons";
import { type ReactNode, useEffect, useState } from "react";

import "./InspectTabs.css";

export interface InspectTabSection {
  id: string;
  // Already-translated tab label.
  label: string;
  icon: IconName;
  // Optional count shown as a trailing pill (Env vars, Ports, Mounts).
  count?: number;
  // The section body — a PropertyPanel, PropertyValueTable, JsonView, etc.
  body: ReactNode;
}

export interface InspectTabsProps {
  sections: InspectTabSection[];
  // Id of the initially-active tab; defaults to the first section.
  defaultTab?: string;
  // Screen id for CSS/test hooks, e.g. "container.inspect".
  dataScreen?: string;
}

// The Inspect screens' section switcher. Mirrors the Settings category rail (SettingsLayout): a left vertical
// rail — a Blueprint ButtonGroup of minimal, left-aligned Buttons on the receding --app-chrome — beside a
// scrollable pane showing the active section's body. Reusable across every resource Inspect screen; the
// active tab is local state, kept valid when the section set changes (Swarm kind switch, async data).
export function InspectTabs({ sections, defaultTab, dataScreen }: InspectTabsProps) {
  const fallback = sections[0]?.id;
  const initial = defaultTab && sections.some((s) => s.id === defaultTab) ? defaultTab : fallback;
  const [activeId, setActiveId] = useState<string | undefined>(initial);
  useEffect(() => {
    if (!sections.some((s) => s.id === activeId)) {
      setActiveId(fallback);
    }
  }, [sections, activeId, fallback]);
  const active = sections.find((s) => s.id === activeId) ?? sections[0];

  return (
    <div className="InspectTabs" data-screen={dataScreen}>
      <div className="InspectTabsRail">
        <ButtonGroup vertical>
          {sections.map((section) => (
            <Button
              key={section.id}
              className="InspectTabItem"
              variant="minimal"
              alignText={Alignment.START}
              fill
              active={active?.id === section.id}
              icon={section.icon}
              onClick={() => setActiveId(section.id)}
              data-tab={section.id}
            >
              <span className="InspectTabLabel">{section.label}</span>
              {typeof section.count === "number" ? (
                <Tag minimal round className="InspectTabCount">
                  {section.count}
                </Tag>
              ) : null}
            </Button>
          ))}
        </ButtonGroup>
      </div>
      <div className="InspectTabsPanel" data-tab={active?.id}>
        {active?.body}
      </div>
    </div>
  );
}
