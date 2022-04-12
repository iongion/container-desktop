import { render } from "react-dom";
import dayjs from "dayjs";

import "./index.css";

import { store } from "./App.store";
import { App } from "./App";

export function renderApplication() {
  const relativeTime = require("dayjs/plugin/relativeTime");
  dayjs.extend(relativeTime);
  const rootElement = document.getElementById("root");
  render(<App store={store} />, rootElement);
}

renderApplication();
