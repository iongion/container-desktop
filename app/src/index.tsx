import { render } from "react-dom";
import dayjs from "dayjs";

import "./index.css";

import App from "./App";

(() => {
  const relativeTime = require("dayjs/plugin/relativeTime");
  dayjs.extend(relativeTime);
  const rootElement = document.getElementById("root");
  render(<App />, rootElement);
})();
