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
import { registerLoggerBackend } from "@/logger";
import { electronLogRendererBackend } from "@/logger/backends/electronLogRenderer";

import { App } from "./App";
import { I18nContextProvider } from "./App.i18n";
import { queryClient } from "./domain/queryClient";
import { CURRENT_ENVIRONMENT } from "./Environment";

dayjs.extend(relativeTime);

export function renderApplication() {
  // Renderer composition root: install the Electron logging adapter so this window's logs forward to
  // main (where the single LOCAL file lives). Console stays with the @/logger façade; if the user has
  // not enabled file logging, main simply drops the forwarded records.
  registerLoggerBackend(electronLogRendererBackend);
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
