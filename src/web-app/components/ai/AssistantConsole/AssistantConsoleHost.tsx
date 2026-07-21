// The summonable AI console: a single app-wide host, mounted once at the App level and portaled to <body>
// so it can overlay the FULL app width (over the sidebar). It renders the SAME <AssistantConversation> as the
// full-page Assistant, against the shared useAIStore session. Summon/dismiss with Ctrl/Cmd+` — the toggle is
// registered in the always-mounted AppLayout (layout-independent, via e.code). Open/variant/opacity/height live in
// uiStore, shared with the header trigger. The transparency slider (quake variants) drives --console-opacity so the
// screen shows through; dragging the header grip drives --console-height (quake variants, clamped 10–80%).
import { Button } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiRobot } from "@mdi/js";
import * as ReactIcon from "@mdi/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { AssistantConversation } from "@/web-app/components/ai/AssistantConversation";
import { CONSOLE_HEIGHT_MAX, CONSOLE_HEIGHT_MIN, clampConsoleHeight, useUIStore } from "@/web-app/stores/uiStore";

import "./AssistantConsole.css";

// Percent step per Arrow key press when resizing the console from the keyboard.
const HEIGHT_KEY_STEP = 3;

export const AssistantConsoleHost: React.FC = () => {
  const { t } = useTranslation();
  const open = useUIStore((s) => s.assistantConsole.open);
  const variant = useUIStore((s) => s.assistantConsole.variant);
  const opacity = useUIStore((s) => s.assistantConsole.opacity);
  const height = useUIStore((s) => s.assistantConsole.height);
  const screenTitle = useUIStore((s) => s.currentScreen.title);
  const setOpen = useUIStore((s) => s.setAssistantConsoleOpen);
  const setOpacity = useUIStore((s) => s.setAssistantConsoleOpacity);
  const setHeight = useUIStore((s) => s.setAssistantConsoleHeight);

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

  // Pointer drag on the header grip resizes the quake console vertically. We track the absolute pointer travel
  // from where the drag began (startHeight + total delta) rather than accumulating per-move, so overshooting a
  // clamp bound and dragging back recovers exactly. The bottom quake grows as the top grip is dragged up
  // (sign −1); the top quake grows as the bottom grip is dragged down (sign +1). setHeight clamps to 10–80%.
  const dragRef = useRef<{ startY: number; startHeight: number; sign: number } | null>(null);
  const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (variant !== "top" && variant !== "bottom") {
      return;
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startHeight: height, sign: variant === "top" ? 1 : -1 };
  };
  const onHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    const deltaPct = ((drag.sign * (e.clientY - drag.startY)) / window.innerHeight) * 100;
    setHeight(clampConsoleHeight(drag.startHeight + deltaPct, window.innerHeight));
  };
  const onHandlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) {
      return;
    }
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };
  // Keyboard resize for the focusable splitter: Arrow up/down nudge by HEIGHT_KEY_STEP, moving the grip the
  // same direction the pointer would (so the panel grows when the grip is pushed away from its anchor edge).
  const onHandleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (variant !== "top" && variant !== "bottom") {
      return;
    }
    const dir = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    if (dir === 0) {
      return;
    }
    e.preventDefault();
    const sign = variant === "top" ? 1 : -1;
    setHeight(clampConsoleHeight(height + sign * dir * HEIGHT_KEY_STEP, window.innerHeight));
  };

  return createPortal(
    <div
      className="AssistantConsoleRoot"
      data-variant={variant}
      data-open={open ? "true" : "false"}
      style={{ "--console-opacity": opacity, "--console-height": `${height}%` } as React.CSSProperties}
    >
      <button
        type="button"
        className="AssistantConsoleScrim"
        aria-label={t("Close assistant")}
        tabIndex={-1}
        onClick={() => setOpen(false)}
      />
      <aside ref={asideRef} className="AssistantConsole" role="dialog" aria-label={t("Assistant")} aria-hidden={!open}>
        {/* biome-ignore lint/a11y/useSemanticElements: a focusable separator with aria-valuenow is the ARIA
            window-splitter (resize handle) pattern, deliberately not a static <hr>. */}
        <div
          className="AssistantConsoleResizeHandle"
          role="separator"
          tabIndex={0}
          aria-orientation="horizontal"
          aria-label={t("Resize assistant")}
          aria-valuenow={Math.round(height)}
          aria-valuemin={CONSOLE_HEIGHT_MIN}
          aria-valuemax={CONSOLE_HEIGHT_MAX}
          title={t("Drag to resize")}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
          onKeyDown={onHandleKeyDown}
        />
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
