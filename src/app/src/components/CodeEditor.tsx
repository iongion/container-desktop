import { useEffect } from "react";
import Editor, { useMonaco } from "@monaco-editor/react";

import "./CodeEditor.css";

export const DEFAULT_THEME = "vs-dark";

export interface CodeEditorProps {
  value: string;
  mode?: string;
  theme?: string;
  headerTitle?: any;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({ value, mode, theme, headerTitle }) => {
  const monaco = useMonaco();
  useEffect(() => {
    // or make sure that it exists by other ways
    if (monaco) {
      monaco.editor.setTheme(theme || DEFAULT_THEME);
    }
  }, [monaco, theme]);
  return (
    <div className="CodeEditor">
      {headerTitle ? <div className="CodeEditorHeader">{headerTitle}</div> : null}
      <Editor
        height="100%"
        language={mode || "json"}
        value={value}
        theme={theme || DEFAULT_THEME}
        options={{
          readOnly: true,
          automaticLayout: true,
          minimap: {
            enabled: false
          },
          fontSize: 11,
          cursorStyle: "block",
          wordWrap: "on",
          theme: theme || DEFAULT_THEME
        }}
      />
    </div>
  );
};
