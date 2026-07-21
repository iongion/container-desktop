import Editor, { type OnMount, useMonaco } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor/editor/editor.api.js";
import { useEffect, useRef, useState } from "react";

import { createLogger } from "@/logger";
import { AppTheme } from "@/web-app/App.types";
import { useAppStore } from "@/web-app/stores/appStore";

import { applyModelMarkers } from "./applyModelMarkers";
import { registerFindTarget } from "./Find/findTargets";
// Bundle Monaco locally (offline) instead of loading it from a CDN — must be
// imported before <Editor> mounts so loader.config() runs before loader.init().
import "./monaco-setup";
import "./CodeEditor.css";

const logger = createLogger("web.CodeEditor");

export const DARK_THEME = "vs-dark";
// Monaco's built-in light theme is "vs" — "vs-light" is not a registered theme, so
// setTheme() would silently ignore it and leave the editor stuck on the dark theme.
export const LIGHT_THEME = "vs";
export const DEFAULT_THEME = DARK_THEME;

export interface CodeEditorProps {
  value: string;
  mode?: string;
  theme?: string;
  headerTitle?: any;
  withoutLineNumbers?: boolean;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  markers?: Monaco.editor.IMarkerData[];
  // Render hover/suggest widgets in a fixed, top-level layer so they escape a clipping/overflow-hidden
  // ancestor (e.g. the bordered Build Studio panel with a header above the editor).
  overflowWidgetsFixed?: boolean;
}

const CodeEditorImpl: React.FC<CodeEditorProps> = ({
  withoutLineNumbers,
  value,
  mode,
  theme,
  headerTitle,
  readOnly,
  onChange,
  markers,
  overflowWidgetsFixed,
}: CodeEditorProps) => {
  const userTheme = useAppStore((state) => state.userSettings.theme);
  const [currentTheme, setCurrentTheme] = useState(theme || (userTheme === AppTheme.LIGHT ? LIGHT_THEME : DARK_THEME));
  const monaco = useMonaco();
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const [editorInstance, setEditorInstance] = useState<Parameters<OnMount>[0] | null>(null);
  useEffect(() => {
    if (!monaco) {
      logger.warn("Monaco editor not ready - theming skipped");
      return;
    }
    if (userTheme === AppTheme.DARK) {
      monaco.editor.setTheme(DARK_THEME);
      setCurrentTheme(DARK_THEME);
    } else if (userTheme === AppTheme.LIGHT) {
      monaco.editor.setTheme(LIGHT_THEME);
      setCurrentTheme(LIGHT_THEME);
    }
  }, [monaco, userTheme]);
  // Re-publish linter markers whenever they (or the editor) change; the model owns them so they persist
  // across edits and clear when `markers` is emptied.
  useEffect(() => {
    applyModelMarkers(monaco, editorInstance, markers);
  }, [monaco, editorInstance, markers]);
  // Let the global find host open Monaco's own native find for this editor.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    return registerFindTarget({
      type: "monaco",
      el,
      openFind: () => {
        editorRef.current?.focus();
        editorRef.current?.getAction("actions.find")?.run();
      },
    });
  }, []);
  return (
    <div className="CodeEditor" ref={containerRef}>
      {headerTitle ? <div className="CodeEditorHeader">{headerTitle}</div> : null}
      <Editor
        height="100%"
        language={mode || "json"}
        value={value}
        theme={currentTheme}
        onChange={(next) => onChange?.(next ?? "")}
        onMount={(editor) => {
          editorRef.current = editor;
          setEditorInstance(editor);
        }}
        options={{
          readOnly: readOnly ?? true,
          automaticLayout: true,
          minimap: {
            enabled: false,
          },
          fontSize: 11,
          cursorStyle: "block",
          wordWrap: "on",
          theme: currentTheme,
          lineNumbers: withoutLineNumbers ? "off" : "on",
          fixedOverflowWidgets: overflowWidgetsFixed ?? false,
        }}
      />
    </div>
  );
};

export default CodeEditorImpl;
