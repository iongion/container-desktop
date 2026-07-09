// Single shared nunjucks Environment for all AI prompt templates.
// autoescape:false so markdown/code passes through unescaped; .trim() removes leading/trailing
// whitespace the .md template may add. Callers provide the raw template string and a context dict.

// The BROWSER build of nunjucks (precompiled, no filesystem loaders) — so this module pulls in NO Node
// dependency at all and is safe in any bundle (renderer or main). renderString()/Environment are
// identical to the node build. See nunjucks-browser.d.ts for the type shim.
import nunjucks from "nunjucks/browser/nunjucks.js";

const env = new nunjucks.Environment(undefined as any, { autoescape: false });

export function renderPrompt(template: string, ctx: Record<string, unknown>): string {
  return env.renderString(template, ctx).trim();
}
