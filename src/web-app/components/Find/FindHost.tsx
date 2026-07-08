// Single, app-wide find host. Mounted once inside `.AppContentDocument`, it registers one
// global `mod+f` Blueprint hotkey and routes by the active screen's content:
//   terminal/dom -> open our themed overlay backed by the matching engine
//   monaco       -> open Monaco's own native find (kept as-is)
//   filter       -> focus the list screen's existing row-filter input
// In-widget navigation (enter / shift+enter / escape) uses local Blueprint hotkeys bound to
// the widget root, so we never hand-roll a window keydown listener.

import { type HotkeyConfig, useHotkeys } from "@blueprintjs/core";
import { useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { createDomFindEngine } from "./domFindEngine";
import "./Find.css";
import { FindWidget } from "./FindWidget";
import { resolveFindRoute } from "./findRouting";
import { createTerminalFindEngine } from "./terminalFindEngine";
import type { FindEngine, FindResults } from "./types";

interface WidgetPosition {
  top: number;
  right: number;
}

const DEFAULT_POSITION: WidgetPosition = { top: 12, right: 24 };

function computePosition(root: HTMLElement | null): WidgetPosition {
  const host = document.querySelector<HTMLElement>(".AppContentDocument");
  if (!root || !host) {
    return DEFAULT_POSITION;
  }
  const rootRect = root.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  return {
    top: Math.max(8, Math.round(rootRect.top - hostRect.top + 8)),
    right: Math.max(8, Math.round(hostRect.right - rootRect.right + 8)),
  };
}

export const FindHost: React.FC = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState<FindResults>({ index: 0, count: 0 });
  const [position, setPosition] = useState<WidgetPosition>(DEFAULT_POSITION);

  const engineRef = useRef<FindEngine | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pathname = useRouterState({ select: (state) => state.location.pathname });

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const closeOverlay = useCallback(() => {
    engineRef.current?.clear();
    engineRef.current = null;
    rootRef.current = null;
    setOpen(false);
    setQuery("");
    setResults({ index: 0, count: 0 });
  }, []);

  // Close + clear when navigating away — highlights belong to the unmounting screen's DOM.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally reacts to route changes only
  useEffect(() => {
    if (open) {
      closeOverlay();
    }
  }, [pathname]);

  const onTrigger = useCallback(
    (event: KeyboardEvent) => {
      if (open) {
        event.preventDefault();
        focusInput();
        return;
      }
      const route = resolveFindRoute();
      if (route.kind === "none") {
        return;
      }
      event.preventDefault();
      if (route.kind === "monaco") {
        if (route.target?.type === "monaco") {
          route.target.openFind();
        }
        return;
      }
      if (route.kind === "filter") {
        route.filterInput?.focus();
        route.filterInput?.select();
        return;
      }
      engineRef.current =
        route.kind === "terminal"
          ? createTerminalFindEngine(() => (route.target?.type === "terminal" ? route.target.getSearchAddon() : null))
          : createDomFindEngine(() => route.root);
      rootRef.current = route.root;
      setPosition(computePosition(route.root));
      setResults({ index: 0, count: 0 });
      setOpen(true);
      focusInput();
    },
    [open, focusInput],
  );

  // Subscribe to the active engine's result changes while open.
  useEffect(() => {
    if (!open || !engineRef.current) {
      return;
    }
    return engineRef.current.subscribe(setResults);
  }, [open]);

  // (Re)apply the search when the query or case option changes (debounced).
  useEffect(() => {
    if (!open || !engineRef.current) {
      return;
    }
    const handle = window.setTimeout(() => {
      engineRef.current?.apply(query, { caseSensitive });
    }, 120);
    return () => window.clearTimeout(handle);
  }, [open, query, caseSensitive]);

  // Keep the widget anchored to the content when the window resizes.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onResize = () => setPosition(computePosition(rootRef.current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  const goNext = useCallback(() => engineRef.current?.next(), []);
  const goPrevious = useCallback(() => engineRef.current?.previous(), []);
  const toggleCase = useCallback(() => setCaseSensitive((value) => !value), []);

  const hotkeys = useMemo<HotkeyConfig[]>(
    () => [
      {
        combo: "mod+f",
        global: true,
        allowInInput: true,
        label: t("Find in current view"),
        group: t("Find"),
        onKeyDown: onTrigger,
      },
      {
        combo: "escape",
        allowInInput: true,
        label: t("Close find"),
        group: t("Find"),
        onKeyDown: () => {
          if (open) {
            closeOverlay();
          }
        },
      },
      {
        combo: "enter",
        allowInInput: true,
        label: t("Next match"),
        group: t("Find"),
        onKeyDown: () => {
          if (open) {
            goNext();
          }
        },
      },
      {
        combo: "shift+enter",
        allowInInput: true,
        label: t("Previous match"),
        group: t("Find"),
        onKeyDown: () => {
          if (open) {
            goPrevious();
          }
        },
      },
    ],
    [t, onTrigger, open, closeOverlay, goNext, goPrevious],
  );
  const { handleKeyDown, handleKeyUp } = useHotkeys(hotkeys);

  if (!open) {
    return null;
  }
  return (
    <FindWidget
      query={query}
      onQueryChange={setQuery}
      caseSensitive={caseSensitive}
      onToggleCase={toggleCase}
      index={results.index}
      count={results.count}
      onNext={goNext}
      onPrevious={goPrevious}
      onClose={closeOverlay}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      inputRef={inputRef}
      style={{ top: position.top, right: position.right }}
    />
  );
};
