// WebKitWebDriver collapses a run of identical keys inside one action chain — `browser.keys("all")` arrives as
// "al", and `browser.keys(" add")` as " ad", silently. It is the chain, not the app: a plain textarea appended
// outside React loses exactly the same characters. Split the text so no chain ever repeats a character; separate
// calls each send their own keyDown/keyUp, so the repeat survives.
export function keystrokeChunks(text) {
  const chunks = [];
  let chunk = "";
  for (const character of text) {
    if (chunk && character === chunk.at(-1)) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
