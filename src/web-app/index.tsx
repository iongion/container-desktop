import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { createRoot } from "react-dom/client";
import { Helmet, HelmetProvider } from "react-helmet-async";

import "./index.css";

import { ContainerEngine, Environments } from "@/env/Types";
import { App } from "./App";
import { I18nContextProvider } from "./App.i18n";
import { queryClient } from "./domain/queryClient";
import { CURRENT_ENVIRONMENT } from "./Environment";
import "./themes/docker.css";
import "./themes/podman.css";
import "./themes/shared.css";

dayjs.extend(relativeTime);

export async function renderApplication() {
  const container = document.getElementById("root");
  const root = createRoot(container!);
  console.debug("Settings up the native bridge");
  console.debug("Starting web-app", { engine: ContainerEngine.PODMAN });
  root.render(
    // <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nContextProvider>
        <HelmetProvider>
          <Helmet>
            <body className="bp6-dark" data-engine={ContainerEngine.PODMAN} />
          </Helmet>
          <App />
          {CURRENT_ENVIRONMENT === Environments.DEVELOPMENT && <ReactQueryDevtools initialIsOpen={false} />}
        </HelmetProvider>
      </I18nContextProvider>
    </QueryClientProvider>,
    //</StrictMode>
  );
}

renderApplication();
