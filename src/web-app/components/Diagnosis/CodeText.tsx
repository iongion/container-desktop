import { Fragment } from "react";

// Renders a plain string with markdown-style backtick spans as inline <code>. Shared by the Diagnosis stripe
// (reachability debugger + Engine Health cockpit).
export function CodeText({ text }: { text: string }) {
  // Split on backticks; odd segments are `code`. Key by the segment's byte offset (stable + unique) so we never
  // key by array index (the text is static, but Biome forbids index keys).
  const segments: { key: string; code: boolean; value: string }[] = [];
  let offset = 0;
  text.split("`").forEach((part, index) => {
    segments.push({ key: `s${offset}`, code: index % 2 === 1, value: part });
    offset += part.length + 1;
  });
  return (
    <>
      {segments.map((segment) =>
        segment.code ? (
          <code key={segment.key}>{segment.value}</code>
        ) : (
          <Fragment key={segment.key}>{segment.value}</Fragment>
        ),
      )}
    </>
  );
}
