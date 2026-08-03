// Bundle Monaco locally and register its web workers so the editor works OFFLINE.
//
// By default @monaco-editor/loader fetches Monaco from a CDN (jsdelivr) at runtime —
// that breaks with no network connection and silently ignores the pinned
// `monaco-editor` version. Pointing the loader at the bundled instance (and wiring
// the language workers via Vite's `?worker`) keeps everything local and version-correct.
//
// This module is import-only (side effects); import it before the editor mounts.
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/language/json/monaco.contribution.js";
// Basic-languages Monarch tokenizers give offline syntax highlighting for the read-only JS/TS code examples
// (e.g. the Connection info "code example", language="javascript") and the writable Build Studio Dockerfile
// editor. They colorize on the main thread and need no dedicated worker — unlike the JSON language service
// above — so the base editor worker is enough. Monaco 0.56 consolidated the per-language contributions into
// this single entry, which lazily registers every basic language (tokenizers load on first use).
import "monaco-editor/basic-languages/monaco.contribution.js";

import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";

// Monaco requests a worker per language. JSON gets its dedicated language service;
// everything else the app renders (yaml / markdown / text) falls back to the base
// editor worker, which is enough for the read-only viewers in this app.
self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === "json") {
      return new JsonWorker();
    }
    return new EditorWorker();
  },
};

// Use the bundled Monaco instead of the CDN default. Must run before the first
// <Editor>/useMonaco() mount (which triggers loader.init()).
loader.config({ monaco });
