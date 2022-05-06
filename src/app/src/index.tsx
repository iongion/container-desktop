import { render } from "react-dom";
import dayjs from "dayjs";

import "./index.css";

import { store } from "./App.store";
import { App } from "./App";

import "./themes/podman.css";
import "./themes/docker.css";
import { Native } from "./Native";
import { Helmet } from "react-helmet";

export function renderApplication() {
  const relativeTime = require("dayjs/plugin/relativeTime");
  dayjs.extend(relativeTime);
  const rootElement = document.getElementById("root");
  const adapter = (Native.getInstance().getDefaultConnector() || "").split(".")[2] || "";
  console.debug(adapter)
  render(<>
      <Helmet>
        <body className="bp4-dark" data-adapter={adapter} />
      </Helmet><App store={store} />
  </>, rootElement);
}

renderApplication();
