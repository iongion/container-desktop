// Parse a prompt resource whose level-two headings are stable record keys. The body remains ordinary markdown;
// this only supplies structured lookup without moving model-facing prose back into TypeScript.
export function parseMarkdownSections(source: string): Readonly<Record<string, string>> {
  const sections: Record<string, string> = {};
  let key: string | undefined;
  let body: string[] = [];

  const commit = () => {
    if (!key) return;
    if (Object.hasOwn(sections, key)) throw new Error(`Prompt resource has duplicate section: ${key}`);
    sections[key] = body.join("\n").trim();
  };

  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = /^##(?:[ \t]+(.*)|[ \t]*)$/.exec(line);
    if (!heading) {
      if (key) body.push(line);
      continue;
    }
    commit();
    key = (heading[1] ?? "").trim();
    if (!key) throw new Error("Prompt resource has an empty section name");
    body = [];
  }
  commit();
  return sections;
}
