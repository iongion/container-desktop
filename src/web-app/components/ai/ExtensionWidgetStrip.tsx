// A pi extension's widget lines, rendered where the TUI puts them: above or below the composer. Content is
// plain text an extension composed for a terminal, so it stays monospace and is never parsed as markdown.
import type { CodingAgentChrome } from "@/web-app/stores/codingAgent";

import "./ExtensionWidgetStrip.css";

export interface ExtensionWidgetStripProps {
  widgets: CodingAgentChrome["widgets"];
  placement: "aboveEditor" | "belowEditor";
}

export const ExtensionWidgetStrip: React.FC<ExtensionWidgetStripProps> = ({ widgets, placement }) => {
  const entries = Object.entries(widgets).filter(([, widget]) => widget.placement === placement);
  if (entries.length === 0) return null;
  return (
    <div className={`ExtensionWidgetStrip ExtensionWidgetStrip--${placement}`}>
      {entries.map(([key, widget]) => (
        <pre key={key} className="ExtensionWidget">
          {widget.lines.join("\n")}
        </pre>
      ))}
    </div>
  );
};

// setStatus is the TUI's footer line. Here it recedes next to the composer: keyed entries an extension raises
// and clears, never a notification — a status that clears itself must not leave a toast behind.
export const ExtensionStatusStrip: React.FC<{ statuses: CodingAgentChrome["statuses"] }> = ({ statuses }) => {
  const entries = Object.entries(statuses);
  if (entries.length === 0) return null;
  return (
    <div className="ExtensionStatusStrip">
      {entries.map(([key, text]) => (
        <span key={key} className="ExtensionStatus">
          <span className="ExtensionStatusKey">{key}</span>
          {text}
        </span>
      ))}
    </div>
  );
};
