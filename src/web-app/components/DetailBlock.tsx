import type { ReactNode } from "react";

import "./DetailBlock.css";

// A labelled, preformatted detail: an uppercase label with an optional action beside it (a copy button), then the text.
// Used by the activity log's expanded rows and the setup wizard's failed-step Details.
export function DetailBlock({ label, value, action }: { label: string; value?: string; action?: ReactNode }) {
  if (!value && !action) {
    return null;
  }
  return (
    <div className="DetailBlock">
      <div className="DetailBlockLabel">
        <span>{label}</span>
        {action}
      </div>
      {value ? <pre className="DetailBlockPre">{value}</pre> : null}
    </div>
  );
}
