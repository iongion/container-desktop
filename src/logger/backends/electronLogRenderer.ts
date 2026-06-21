// Electron RENDERER logging adapter (one LoggerBackend behind the @/logger port). It forwards already
// level-gated records to MAIN over electron-log's ipc bridge (installed by log.initialize() in main),
// where the single LOCAL file lives. The renderer never writes a file itself, and console output stays
// with the @/logger façade.
//
// Only the renderer composition root imports this module, so electron-log/renderer never leaks into the
// main bundle.

import log from "electron-log/renderer";

import type { LoggerBackend } from "@/logger";

let initialized = false;
const scopes = new Map<string, any>();

function scoped(scope: string): any {
  let instance = scopes.get(scope);
  if (!instance) {
    instance = log.scope(scope);
    scopes.set(scope, instance);
  }
  return instance;
}

function setup(): void {
  if (initialized) {
    return;
  }
  initialized = true;
  // Console is owned by the @/logger façade; electron-log/renderer only FORWARDS to main (its ipc
  // transport). There is no remote/cloud sink in the renderer.
  if (log.transports.console) {
    log.transports.console.level = false;
  }
}

// The persistence sink the @/logger façade calls in the RENDERER: hand the record to electron-log, which
// forwards it to MAIN where it is written to the rotating local file (when the user has enabled it).
export const electronLogRendererBackend: LoggerBackend = {
  write(level, scope, args) {
    setup();
    scoped(scope)[level](...args);
  },
};
