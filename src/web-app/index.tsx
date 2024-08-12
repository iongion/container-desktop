import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { createRoot } from "react-dom/client";
import { Helmet } from "react-helmet";

import "./index.css";

import { App } from "./App";
import { I18nContextProvider } from "./App.i18n";
import { store } from "./App.store";
import { Native } from "./Native";

import "./themes/docker.css";
import "./themes/podman.css";
import "./themes/shared.css";

dayjs.extend(relativeTime);

export function renderApplication() {
  const container = document.getElementById("root");
  const root = createRoot(container!);
  const adapter = (Native.getInstance().getDefaultConnector() || "").split(".")[2] || "";
  console.debug("Starting web-app", { adapter });
  root.render(
    // <StrictMode>
    <I18nContextProvider>
      <Helmet>
        <body className="bp5-dark" data-adapter={adapter} />
      </Helmet>
      <App store={store} />
    </I18nContextProvider>
    //</StrictMode>
  );
}

renderApplication();
