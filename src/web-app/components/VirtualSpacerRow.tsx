// A single zero-content <tr> that reserves the height of the rows windowed out above/below the viewport
// in a virtualized <HTMLTable> (see useWindowedRows). It must be a direct child of <tbody>; its lone
// colSpan cell carries only a height, so it never participates in column sizing or striping
// (neutralized in App.css via `.AppVirtualSpacer`).

export interface VirtualSpacerRowProps {
  height: number;
  columnCount: number;
}

export function VirtualSpacerRow({ height, columnCount }: VirtualSpacerRowProps) {
  if (height <= 0) {
    return null;
  }
  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: Architected this way!
    <tr className="AppVirtualSpacer" aria-hidden="true">
      <td colSpan={columnCount} style={{ height }} />
    </tr>
  );
}
