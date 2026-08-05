// Pure, node-free workspace text + POSIX-path primitives shared by the two IWorkspaceAccess implementations:
// the native local workspace (each shell's `workspaceAccess.ts`) and the exec-routed container workspace
// (`execWorkspaceAccess.ts`, which runs in the Tauri/Wails webview realm).
// Because the exec-routed workspace enters the webview bundle, these helpers must import NO node builtins: the
// posix path math is done here by hand instead of `node:path`, so a single implementation confines paths
// identically on both sides. Confinement is the security boundary — see resolvePosixWithinRoot's callers and
// its dedicated escape tests.

// Normalize a POSIX path: drop "" and "." segments, resolve ".." (an absolute path can never rise above "/"; a
// relative one keeps a leading ".."). Mirrors node:path.posix normalization for the absolute inputs used here.
function normalizePosix(input: string): string {
  const isAbsolute = input.startsWith("/");
  const out: string[] = [];
  for (const segment of input.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (!isAbsolute) out.push("..");
      // An absolute path swallows a leading "..": there is nothing above the root to escape to.
    } else {
      out.push(segment);
    }
  }
  return (isAbsolute ? "/" : "") + out.join("/");
}

// Resolve `requested` against an ABSOLUTE `root` (an absolute `requested` wins outright), then normalize. Equals
// node:path.posix.resolve(root, requested) for the inputs here (root is always an absolute target path).
export function posixResolve(root: string, requested: string): string {
  return normalizePosix(requested.startsWith("/") ? requested : `${root}/${requested}`);
}

// The relative path from `from` to `to`, both absolute. Equals node:path.posix.relative for these inputs.
export function posixRelative(from: string, to: string): string {
  const fromParts = normalizePosix(from).split("/").filter(Boolean);
  const toParts = normalizePosix(to).split("/").filter(Boolean);
  let shared = 0;
  while (shared < fromParts.length && shared < toParts.length && fromParts[shared] === toParts[shared]) shared += 1;
  const up = fromParts.slice(shared).map(() => "..");
  return [...up, ...toParts.slice(shared)].join("/");
}

// The directory portion of an already-normalized absolute path. Equals node:path.posix.dirname for such inputs.
export function posixDirname(p: string): string {
  const idx = p.lastIndexOf("/");
  if (idx < 0) return ".";
  if (idx === 0) return "/";
  return p.slice(0, idx);
}

// Apply an in-place string edit. Without replaceAll, `oldString` must occur exactly once (unambiguous).
export function applyStringEdit(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): { after: string; replacements: number } {
  if (oldString === "") throw new Error("editFile: oldString must not be empty");
  if (replaceAll) {
    const parts = content.split(oldString);
    const replacements = parts.length - 1;
    if (replacements === 0) throw new Error("editFile: oldString not found in the file");
    return { after: parts.join(newString), replacements };
  }
  const first = content.indexOf(oldString);
  if (first === -1) throw new Error("editFile: oldString not found in the file");
  if (content.indexOf(oldString, first + oldString.length) !== -1) {
    throw new Error("editFile: oldString is not unique; add surrounding context or set replaceAll");
  }
  return {
    after: content.slice(0, first) + newString + content.slice(first + oldString.length),
    replacements: 1,
  };
}

// Translate a glob (`*` within a segment, `**` across segments, `?` one non-slash char) into an anchored RegExp.
export function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        source += ".*";
        i += 1;
        if (pattern[i + 1] === "/") i += 1;
      } else {
        source += "[^/]*";
      }
    } else if (c === "?") {
      source += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      source += `\\${c}`;
    } else {
      source += c;
    }
  }
  return new RegExp(`^${source}$`);
}
