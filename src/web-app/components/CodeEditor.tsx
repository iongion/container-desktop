import Editor, { type OnMount, useMonaco } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";

import { AppTheme } from "@/web-app/App.types";
import { useAppStore } from "@/web-app/stores/appStore";
import { registerFindTarget } from "./Find/findTargets";
// Bundle Monaco locally (offline) instead of loading it from a CDN — must be
// imported before <Editor> mounts so loader.config() runs before loader.init().
import "./monaco-setup";
import "./CodeEditor.css";

export const DARK_THEME = "vs-dark";
export const LIGHT_THEME = "vs-light";
export const DEFAULT_THEME = DARK_THEME;

export interface CodeEditorProps {
  value: string;
  mode?: string;
  theme?: string;
  headerTitle?: any;
  withoutLineNumbers?: boolean;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  withoutLineNumbers,
  value,
  mode,
  theme,
  headerTitle,
}: CodeEditorProps) => {
  const userTheme = useAppStore((state) => state.userSettings.theme);
  const [currentTheme, setCurrentTheme] = useState(theme || DEFAULT_THEME);
  const monaco = useMonaco();
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  useEffect(() => {
    if (!monaco) {
      console.warn("Monaco editor not ready - theming skipped");
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
        onMount={(editor) => {
          editorRef.current = editor;
        }}
        options={{
          readOnly: true,
          automaticLayout: true,
          minimap: {
            enabled: false,
          },
          fontSize: 11,
          cursorStyle: "block",
          wordWrap: "on",
          theme: currentTheme,
          lineNumbers: withoutLineNumbers ? "off" : "on",
        }}
      />
    </div>
  );
};
