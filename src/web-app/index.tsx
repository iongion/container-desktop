import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { createRoot } from "react-dom/client";
import { Helmet, HelmetProvider } from "react-helmet-async";

import "./index.css";

import { App } from "./App";
import { I18nContextProvider } from "./App.i18n";
import { store } from "./App.store";

import { ContainerEngine } from "@/env/Types";
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
    <I18nContextProvider>
      <HelmetProvider>
        <Helmet>
          <body className="bp5-dark" data-engine={ContainerEngine.PODMAN} />
        </Helmet>
        <App store={store} />
      </HelmetProvider>
    </I18nContextProvider>,
    //</StrictMode>
  );
}

renderApplication();
