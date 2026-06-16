// Full-app renderer. Extracted from index.tsx so the popover entry (index.html#tray) can be
// dynamically imported separately and NEVER execute this bootstrap. TrayBridge is mounted here
// (inside the QueryClient + i18n providers) so it only runs in the authority window.

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { createRoot } from "react-dom/client";
import { Helmet, HelmetProvider } from "react-helmet-async";

import { ContainerEngine, Environments } from "@/env/Types";

import { App } from "./App";
import { I18nContextProvider } from "./App.i18n";
import { queryClient } from "./domain/queryClient";
import { CURRENT_ENVIRONMENT } from "./Environment";
import { TrayBridge } from "./tray/TrayBridge";

dayjs.extend(relativeTime);

export function renderApplication() {
  const container = document.getElementById("root");
  const root = createRoot(container!);
  root.render(
    <QueryClientProvider client={queryClient}>
      <I18nContextProvider>
        <HelmetProvider>
          <Helmet>
            <body className="bp6-dark" data-engine={ContainerEngine.PODMAN} />
          </Helmet>
          <App />
          <TrayBridge />
          {CURRENT_ENVIRONMENT === Environments.DEVELOPMENT && <ReactQueryDevtools initialIsOpen={false} />}
        </HelmetProvider>
      </I18nContextProvider>
    </QueryClientProvider>,
  );
}
