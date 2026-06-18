// Custom monochrome connect/disconnect icons used by EVERY connect/disconnect action in the app. Pure inline
// SVG drawn with `stroke="currentColor"` so each glyph inherits the host button's color (styleable, theme-
// aware) and stays crisp at 16px. The universal "link" metaphor: two link-ends joined by a bar = connected;
// the bar broken with a gap = disconnected.

export interface ConnectionIconProps {
  size?: number;
  className?: string;
}

const COMMON = {
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  // `display: block` kills the inline-SVG baseline descender gap (otherwise the glyph sits high and leaves
  // stray space below it inside buttons). Keeps every connect/disconnect button tightly sized + centered.
  style: { display: "block" },
};

// Connected: a whole chain link — two hooks joined by an unbroken middle bar.
export function ConnectIcon({ size = 16, className }: ConnectionIconProps) {
  return (
    <svg className={className} width={size} height={size} aria-hidden="true" focusable="false" {...COMMON}>
      <path d="M9 7H7a5 5 0 0 0 0 10h2" />
      <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
      <path d="M8 12h8" />
    </svg>
  );
}

// Disconnected: a broken chain link — the two hooks remain but the middle bar is snapped (gap).
export function DisconnectIcon({ size = 16, className }: ConnectionIconProps) {
  return (
    <svg className={className} width={size} height={size} aria-hidden="true" focusable="false" {...COMMON}>
      <path d="M9 7H7a5 5 0 0 0 0 10h2" />
      <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
      <path d="M8 12h2" />
      <path d="M14 12h2" />
    </svg>
  );
}
