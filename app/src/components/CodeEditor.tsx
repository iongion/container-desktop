import "ace-builds";
import AceEditor from "react-ace";
import "ace-builds/webpack-resolver";
import "ace-builds/src-noconflict/mode-json";
import "ace-builds/src-noconflict/mode-text";
import "ace-builds/src-noconflict/theme-solarized_dark";

export interface CodeEditorProps {
  value: string;
  mode?: string;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({ value, mode }) => {
  return (
    <AceEditor
      readOnly
      mode={mode || "json"}
      theme={"solarized_dark"}
      width="100%"
      height="100%"
      fontSize={11}
      editorProps={{ $blockScrolling: true }}
      showPrintMargin={false}
      value={value}
    />
  );
};
