// `data-theme` on <html> and `data-engine` on <body> are what select the `--app-*` token set, so anything
// that repaints the app's colours changes one of them. One observer for the whole app turns that into a
// counter anything colour-dependent can subscribe to — an xterm surface that cannot read CSS var()s, or the
// palette the pi container derives its theme from.
let epoch = 0;
const listeners = new Set<() => void>();
let observer: MutationObserver | undefined;

function bump(): void {
  epoch += 1;
  for (const listener of [...listeners]) listener();
}

function start(): void {
  if (observer || typeof MutationObserver === "undefined") return;
  observer = new MutationObserver(bump);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-engine"] });
  observer.observe(document.body, { attributes: true, attributeFilter: ["class", "data-engine"] });
}

export function subscribeAppThemeEpoch(listener: () => void): () => void {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    observer?.disconnect();
    observer = undefined;
  };
}

export function getAppThemeEpoch(): number {
  return epoch;
}
