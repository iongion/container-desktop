// Where a pi component goes once it has been painted. The app decides the placement — a card body, a strip
// above the composer, a floating panel — and never the content: that is the plugin's own render.
import { useEffect } from "react";

import { AnsiSurface } from "@/web-app/components/ai/AnsiSurface";
import { useCodingAgentStore } from "@/web-app/stores/codingAgent";
import {
  type CodingAgentSurface,
  chromeSurface,
  focusedSurface,
  widgetSurfaces,
} from "@/web-app/stores/codingAgentSurfaces";
import { subscribeAppThemeEpoch } from "@/web-app/themes/appThemeEpoch";

import "./AnsiSurface.css";

// The container derives its pi theme from the app's tokens, so it has to be told when they change: an
// engine switch or a light/dark flip repaints everything except a component that already drew itself.
export function usePiThemeSync(): void {
  const status = useCodingAgentStore((state) => state.status);
  const publishTheme = useCodingAgentStore((state) => state.publishTheme);
  useEffect(() => {
    if (status !== "ready") return;
    return subscribeAppThemeEpoch(() => void publishTheme());
  }, [status, publishTheme]);
}

function useSurfaceIo() {
  const sendSurfaceInput = useCodingAgentStore((state) => state.sendSurfaceInput);
  const reportSurfaceWidth = useCodingAgentStore((state) => state.reportSurfaceWidth);
  return {
    onInput: (surfaceId: string, data: string) => void sendSurfaceInput(surfaceId, data),
    onResize: (surfaceId: string, columns: number) => void reportSurfaceWidth(surfaceId, columns),
  };
}

export const PluginSurface: React.FC<{ surface: CodingAgentSurface }> = ({ surface }) => {
  const io = useSurfaceIo();
  return (
    <AnsiSurface
      surfaceId={surface.surfaceId}
      lines={surface.lines}
      focus={surface.focus}
      onInput={io.onInput}
      onResize={io.onResize}
    />
  );
};

// A tool that renders itself. The card asks for one of its two slots and draws nothing of its own when a
// surface answers, so the plugin's colours are what the user sees.
export const PluginToolSurface: React.FC<{ surface: CodingAgentSurface }> = ({ surface }) => (
  <div className="AnsiSurfacePanel">
    <PluginSurface surface={surface} />
  </div>
);

export const PluginWidgetSurfaces: React.FC<{ placement: "aboveEditor" | "belowEditor" }> = ({ placement }) => {
  const surfaces = useCodingAgentStore((state) => state.surfaces);
  const widgets = widgetSurfaces(surfaces, placement);
  if (widgets.length === 0) return null;
  return (
    <div className="ExtensionWidgetStrip">
      {widgets.map((surface) => (
        // The same panel the footer and a line widget get: a component widget is chrome, and chrome that
        // sits on the bare background next to bordered chrome reads as a rendering glitch.
        <div key={surface.surfaceId} className="AnsiSurfacePanel AnsiSurfacePanel--widget">
          <PluginSurface surface={surface} />
        </div>
      ))}
    </div>
  );
};

export const PluginChromeSurface: React.FC<{ slot: "header" | "footer" }> = ({ slot }) => {
  const surfaces = useCodingAgentStore((state) => state.surfaces);
  const surface = chromeSurface(surfaces, slot);
  if (!surface) return null;
  return (
    <div className={`AnsiSurfacePanel AnsiSurfacePanel--${slot}`}>
      <PluginSurface surface={surface} />
    </div>
  );
};

// A plugin editor replaces the composer while it is open, exactly as it would in pi's TUI. It is shown with
// its owner named, because a composer that has silently become something else is the confusing case.
export const PluginEditorSurface: React.FC = () => {
  const surfaces = useCodingAgentStore((state) => state.surfaces);
  const surface = chromeSurface(surfaces, "editor");
  if (!surface) return null;
  return (
    <div className="AnsiSurfacePanel AnsiSurfacePanel--editor">
      <div className="AnsiSurfacePanelHeader">
        <span>editor provided by an extension</span>
      </div>
      <PluginSurface surface={surface} />
    </div>
  );
};

// The one surface holding the keyboard. Inline above the composer unless the plugin asked for an overlay,
// which floats at the anchor it requested.
export const PluginFocusSurface: React.FC<{ variant: "inline" | "overlay" }> = ({ variant }) => {
  const surfaces = useCodingAgentStore((state) => state.surfaces);
  const surface = focusedSurface(surfaces);
  if (!surface || surface.slot.kind === "editor") return null;
  if ((variant === "overlay") !== surface.overlay) return null;
  if (variant === "inline") {
    return (
      <div className="AnsiSurfacePanel AnsiSurfacePanel--focus">
        <PluginSurface surface={surface} />
      </div>
    );
  }
  const anchor = surface.placement?.anchor ?? "center";
  return (
    <div className={`AnsiSurfacePanel AnsiSurfaceOverlay AnsiSurfaceOverlay--${anchor}`}>
      <PluginSurface surface={surface} />
    </div>
  );
};
