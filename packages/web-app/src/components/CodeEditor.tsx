import { useEffect, useState } from "react";
import Editor, { useMonaco } from "@monaco-editor/react";

import "./CodeEditor.css";
import { AppTheme, useStoreState } from "../domain/types";

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

export const CodeEditor: React.FC<CodeEditorProps> = ({ withoutLineNumbers, value, mode, theme, headerTitle }) => {
  const userTheme = useStoreState((state) => state.descriptor.userSettings.theme);
  const [currentTheme, setCurrentTheme] = useState(theme || DEFAULT_THEME);
  const monaco = useMonaco();
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
  return (
    <div className="CodeEditor">
      {headerTitle ? <div className="CodeEditorHeader">{headerTitle}</div> : null}
      <Editor
        height="100%"
        language={mode || "json"}
        value={value}
        theme={currentTheme}
        options={{
          readOnly: true,
          automaticLayout: true,
          minimap: {
            enabled: false
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
