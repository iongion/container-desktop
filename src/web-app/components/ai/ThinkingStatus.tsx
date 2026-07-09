// The "assistant is working" indicator — a Blueprint spinner beside a status word that cycles through a
// playful list. No external spinner library (Blueprint Spinner is already a core dep); shown above the
// composer input while the model is producing output. First pass for review before weighing react-spinners.
import { Spinner } from "@blueprintjs/core";
import { useEffect, useState } from "react";

import "./ThinkingStatus.css";

const THINKING_WORDS = [
  "Percolating",
  "Unraveling",
  "Crunching",
  "Distilling",
  "Hydrating context",
  "Negotiating with cgroups",
  "Inspecting namespaces",
  "Warming containers",
  "Poking the daemon",
  "Reading the tea logs",
  "Untangling volumes",
  "Consulting the socket",
  "Reticulating splines",
  "Summoning layers",
  "Rebuilding assumptions",
];

export const ThinkingStatus: React.FC = () => {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % THINKING_WORDS.length);
    }, 1800);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="ThinkingStatus">
      <Spinner size={16} />
      <span className="ThinkingStatusText">{THINKING_WORDS[index]}…</span>
    </div>
  );
};
