declare module "i18next" {
  interface CustomTypeOptions {
    returnNull: false;
  }
}

// The agent container's tool descriptions, inlined as text by esbuild (see support/cli/lib/agent-image.ts).
// Declared for this one resource rather than for `*.md`, because a blanket declaration would also promise that a
// bare markdown import works in the renderer graph, where only the `?raw` suffix does.
declare module "@/resources/prompts/agent-tool-descriptions.md" {
  const content: string;
  export default content;
}

// The workspace toolset's descriptions, inlined the same way and for the same reason — declared per resource, not
// for `*.md`.
declare module "@/resources/prompts/workspace-tool-descriptions.md" {
  const content: string;
  export default content;
}

// The built-in troubleshooting knowledge, inlined the same way — declared per resource, not for `*.md`.
declare module "@/resources/prompts/knowledge-bank.md" {
  const content: string;
  export default content;
}

// file-saver ships no types and we only use saveAs; declare it precisely instead of pulling @types.
declare module "file-saver" {
  export function saveAs(data: Blob | string, filename?: string, options?: { autoBom?: boolean }): void;
}
