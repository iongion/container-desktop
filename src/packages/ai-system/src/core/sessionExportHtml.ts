// The conversation as one standalone HTML document — pi's `/share`, minus the gist.
//
// pi shares a session by rendering it to HTML and posting that as a secret GitHub gist. This app holds no GitHub
// credential and a session may be started with no network at all, so the HTML is saved wherever the user chooses.
// pi's own `exportSessionToHtml` is not reachable either: it lives at `core/export-html`, and the package's
// `exports` map publishes only the root and `./rpc-entry`, so a deep import does not resolve. This renders the
// app's transcript instead, which is what the user is actually looking at.
//
// Standalone means standalone: no script, no stylesheet link, nothing to fetch. The file opens years from now with
// no app and no network.

import type { SessionView } from "@/ai-system/core/sessionEvents";
import stylesheet from "@/resources/ai/sessionExport.css?raw";

type TimelineItem = SessionView["timeline"][number];

// Every value in here is model output, tool output or a path the agent chose, and the result is opened in a
// browser. Nothing reaches the document without going through this.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function block(args: unknown): string {
  try {
    return escapeHtml(JSON.stringify(args, null, 2) ?? "");
  } catch {
    return escapeHtml(String(args));
  }
}

function section(attributes: string, heading: string, body: string[]): string {
  return `<article ${attributes}><h2>${escapeHtml(heading)}</h2>${body.join("")}</article>`;
}

function itemHtml(item: TimelineItem): string {
  switch (item.kind) {
    case "message":
      return section(
        `data-kind="message" data-role="${item.role}"${item.status === "error" ? " data-failed" : ""}`,
        item.role === "user" ? "You" : "Assistant",
        [`<p>${escapeHtml(item.content)}</p>`],
      );

    case "tool":
      return section(
        `data-kind="tool"${item.ok === false ? " data-failed" : ""}`,
        `${item.title || item.tool}${item.ok === false ? " — failed" : ""}`,
        [`<pre>${block(item.args)}</pre>`, item.message ? `<pre>${escapeHtml(item.message)}</pre>` : ""],
      );

    // What the user was asked and what they answered. Dropping it would make a gated run read as though nothing
    // had ever been asked.
    case "approval":
      return section(
        `data-kind="approval"${item.status === "rejected" ? " data-failed" : ""}`,
        `${item.title || item.tool} — ${item.status}`,
        [item.reason ? `<p>${escapeHtml(item.reason)}</p>` : "", `<pre>${block(item.args)}</pre>`],
      );

    case "data":
      return section('data-kind="data"', item.customType, [
        item.text ? `<p>${escapeHtml(item.text)}</p>` : "",
        item.data === undefined ? "" : `<pre>${block(item.data)}</pre>`,
      ]);

    case "error":
      return section('data-kind="error" data-failed', "Error", [`<p>${escapeHtml(item.message)}</p>`]);

    // A turn with no content of its own. This document is English, like the rest of it, and the transcript's own
    // wording lives in the renderer.
    case "notice":
      return section('data-kind="notice"', "Assistant", [
        `<p>${item.notice === "output-cap" ? "The model reached its answer limit before writing anything." : "The model answered with nothing."}</p>`,
      ]);

    default:
      return "";
  }
}

export function sessionExportHtml(title: string, model: string, exportedAt: string, view: SessionView): string {
  const heading = title.trim() || "Assistant session";
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeHtml(heading)}</title>`,
    `<style>${stylesheet}</style>`,
    "</head>",
    "<body>",
    `<header><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(model)} · ${escapeHtml(exportedAt)}</p></header>`,
    `<main>${view.timeline.map(itemHtml).join("")}</main>`,
    "<footer>Exported from Container Desktop.</footer>",
    "</body>",
    "</html>",
  ].join("\n");
}

// Named after the conversation so a folder of these is readable. Reduced to a safe stem for the same reason the
// container sanitizes an imported name: a title is chosen by the user, but it also becomes a path.
export function sessionHtmlFilename(title: string): string {
  const stem = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${stem || "assistant-session"}.html`;
}
