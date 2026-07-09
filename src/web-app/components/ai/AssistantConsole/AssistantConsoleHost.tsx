// The summonable AI console: a single app-wide host, mounted once at the App level and portaled to <body>
// so it can overlay the FULL app width (over the sidebar). It renders the SAME <AssistantConversation> as the
// full-page Assistant, against the shared useAIStore session. Summon/dismiss with Ctrl/Cmd+` — the toggle is
// registered in the always-mounted AppLayout (layout-independent, via e.code). Open/variant/opacity live in uiStore, shared
// with the header trigger. The transparency slider (quake variants) drives --console-opacity so the screen
// shows through.
import { Button } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiRobot } from "@mdi/js";
import * as ReactIcon from "@mdi/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { AssistantConversation } from "@/web-app/components/ai/AssistantConversation";
import { useUIStore } from "@/web-app/stores/uiStore";

import "./AssistantConsole.css";

export const AssistantConsoleHost: React.FC = () => {
  const { t } = useTranslation();
  const open = useUIStore((s) => s.assistantConsole.open);
  const variant = useUIStore((s) => s.assistantConsole.variant);
  const opacity = useUIStore((s) => s.assistantConsole.opacity);
  const screenTitle = useUIStore((s) => s.currentScreen.title);
  const setOpen = useUIStore((s) => s.setAssistantConsoleOpen);
  const setOpacity = useUIStore((s) => s.setAssistantConsoleOpacity);

  // Lazy-mount the conversation only once the console has actually been opened, so app start never eagerly
  // creates a chat session or runs model discovery; once mounted it stays (smooth close animation, live store).
  const [everOpened, setEverOpened] = useState(open);
  const asideRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      setEverOpened(true);
    }
  }, [open]);

  // When the console opens, put the caret in the composer so the user can type immediately — on first open
  // and on re-opens of the already-mounted conversation. rAF waits for the slide-in/layout to settle.
  useEffect(() => {
    if (!open) {
      return;
    }
    const host = asideRef.current;
    requestAnimationFrame(() => host?.querySelector<HTMLTextAreaElement>(".AIComposerInput")?.focus());
  }, [open]);

  // The Ctrl/Cmd+` summon toggle lives in the always-mounted AppLayout (matched on e.code, so it is
  // layout-independent) and therefore works even when this host is not mounted. This component only renders
  // the overlay and its close affordances (the ✕ button and the scrim).

  return createPortal(
    <div
      className="AssistantConsoleRoot"
      data-variant={variant}
      data-open={open ? "true" : "false"}
      style={{ "--console-opacity": opacity } as React.CSSProperties}
    >
      <button
        type="button"
        className="AssistantConsoleScrim"
        aria-label={t("Close assistant")}
        tabIndex={-1}
        onClick={() => setOpen(false)}
      />
      <aside ref={asideRef} className="AssistantConsole" role="dialog" aria-label={t("Assistant")} aria-hidden={!open}>
        <div className="AssistantConsoleHeader">
          <span className="AssistantConsoleRobot">
            <ReactIcon.Icon path={mdiRobot} size={0.8} />
          </span>
          <span className="AssistantConsoleTitle">{t("Assistant")}</span>
          {screenTitle ? (
            <span className="AssistantConsoleChip">
              <span className="dot" />
              {screenTitle}
            </span>
          ) : null}
          <span className="AssistantConsoleSpacer" />
          <span className="AssistantConsoleOpacity" title={t("Console transparency")}>
            <input
              type="range"
              min={60}
              max={100}
              value={Math.round(opacity * 100)}
              aria-label={t("Console transparency")}
              onChange={(e) => setOpacity(Number(e.currentTarget.value) / 100)}
            />
          </span>
          <Button
            variant="minimal"
            icon={IconNames.CROSS}
            title={t("Close")}
            aria-label={t("Close")}
            onClick={() => setOpen(false)}
          />
        </div>
        {everOpened ? <AssistantConversation /> : null}
      </aside>
    </div>,
    document.body,
  );
};
