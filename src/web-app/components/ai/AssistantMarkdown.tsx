// Renders an assistant/user message body as rich markdown, styled with Blueprint's OWN primitives rather
// than hand-rolled CSS: tables use `bp6-html-table` (bordered + striped + compact), fenced code uses
// `bp6-code-block` (wrapped with a language label + CopyButton + a scroll cap), inline code uses `bp6-code`,
// headings use `bp6-heading`, lists use `bp6-list`, and blockquotes render as a Blueprint <Callout>. Links
// open externally (the main process' window-open handler routes target=_blank to the system browser).
import { Callout } from "@blueprintjs/core";
import { isValidElement, memo, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { CopyButton } from "@/web-app/components/CopyButton";

import "./AssistantMarkdown.css";

// Flatten a react-markdown children tree back to its source text (fenced code arrives as nested nodes).
function toText(node: unknown): string {
  if (node == null || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(toText).join("");
  }
  if (isValidElement(node)) {
    return toText((node.props as { children?: unknown }).children);
  }
  return "";
}

const CodeBlock: React.FC<{ lang: string; code: string }> = ({ lang, code }) => (
  <div className="AssistantCodeBlock">
    <div className="AssistantCodeBar">
      <span className="AssistantCodeLang">{lang}</span>
      <CopyButton text={code} />
    </div>
    <pre className="bp6-code-block AssistantCodePre">{code}</pre>
  </div>
);

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  h1: ({ children }) => <h1 className="bp6-heading">{children}</h1>,
  h2: ({ children }) => <h2 className="bp6-heading">{children}</h2>,
  h3: ({ children }) => <h3 className="bp6-heading">{children}</h3>,
  h4: ({ children }) => <h4 className="bp6-heading">{children}</h4>,
  h5: ({ children }) => <h5 className="bp6-heading">{children}</h5>,
  h6: ({ children }) => <h6 className="bp6-heading">{children}</h6>,
  ul: ({ children }) => <ul className="bp6-list">{children}</ul>,
  ol: ({ children }) => <ol className="bp6-list">{children}</ol>,
  table: ({ children }) => (
    <div className="AssistantTableScroll">
      <table className="bp6-html-table bp6-html-table-bordered bp6-html-table-striped bp6-compact">{children}</table>
    </div>
  ),
  blockquote: ({ children }) => (
    <Callout className="AssistantMdCallout" compact>
      {children as ReactNode}
    </Callout>
  ),
  // react-markdown wraps fenced code in <pre><code>; unwrap the <pre> so CodeBlock owns the block chrome.
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const text = toText(children);
    const isBlock = /language-/.test(className ?? "") || text.includes("\n");
    if (!isBlock) {
      return <code className="bp6-code">{children}</code>;
    }
    const lang = /language-(\w+)/.exec(className ?? "")?.[1] ?? "";
    return <CodeBlock lang={lang} code={text.replace(/\n$/, "")} />;
  },
};

export interface AssistantMarkdownProps {
  content: string;
}

export const AssistantMarkdown: React.FC<AssistantMarkdownProps> = memo(({ content }) => (
  <div className="AssistantMarkdown bp6-running-text">
    <Markdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </Markdown>
  </div>
));
AssistantMarkdown.displayName = "AssistantMarkdown";
