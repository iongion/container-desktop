import { t } from "@/i18n";

import "./StatusVisuals.css";

export interface StatePillProps {
  // Raw engine run-state token (e.g. "running", "exited", "created"). Drives the color (via data-state) and,
  // translated, the label. Passing the raw token — not a pre-translated string — keeps the color working in
  // every locale.
  state: string;
  className?: string;
}

// The run-state badge (green "running", magenta "exited", …) extracted from the containers table so any
// Inspect panel can show it. The color palette lives in StatusVisuals.css keyed on the lowercased state — the
// same values as the table's .ContainerState, just unscoped from [data-table="containers"].
export function StatePill({ state, className }: StatePillProps) {
  const token = state.trim().toLowerCase();
  return (
    <span className={`StatePill ${className ?? ""}`.trim()} data-state={token}>
      {t(state)}
    </span>
  );
}
