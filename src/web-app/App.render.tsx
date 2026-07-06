// Full-app renderer: the single window's bootstrap, dynamically imported from index.tsx. The tray is a
// native OS menu owned by the main process (there is no tray renderer), so nothing tray-specific mounts here.

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { createRoot } from "react-dom/client";
import { Helmet, HelmetProvider } from "react-helmet-async";

import { isMockMode } from "@/container-client/mock/mode";
import { Environments } from "@/env/Types";
import { type LoggerBackend, registerLoggerBackend } from "@/platform/logger";

import { App } from "./App";
import { I18nContextProvider } from "./App.i18n";
import { queryClient } from "./domain/queryClient";
import { CURRENT_ENVIRONMENT } from "./Environment";

dayjs.extend(relativeTime);

export function renderApplication(opts?: { loggerBackend?: LoggerBackend }) {
  // Renderer composition root. The shell-selection root (index.tsx) hands us the shell's log backend
  // (Electron: renderer→main forwarder; Tauri: none yet) so this file stays backend-free. Console stays
  // with the @/platform/logger façade; if file logging is off, main simply drops the forwarded records.
  if (opts?.loggerBackend) {
    registerLoggerBackend(opts.loggerBackend);
  }
  const container = document.getElementById("root");
  const root = createRoot(container!);
  const showDevtools = CURRENT_ENVIRONMENT === Environments.DEVELOPMENT && !isMockMode();
  root.render(
    <QueryClientProvider client={queryClient}>
      <I18nContextProvider>
        <HelmetProvider>
          <Helmet>
            <body className="bp6-dark" data-engine="unified" />
          </Helmet>
          <App />
          {showDevtools && <ReactQueryDevtools initialIsOpen={false} />}
        </HelmetProvider>
      </I18nContextProvider>
    </QueryClientProvider>,
  );
}
