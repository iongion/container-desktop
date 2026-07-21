# Workspace tool descriptions

## readFile

Read a UTF-8 text file from the workspace. `path` is relative to the workspace root; paths that escape the workspace are rejected by the host. Returns the file's full contents. Prefer this over guessing a file's contents.

## listDirectory

List the entries of a directory in the workspace (each entry's name and whether it is a file, directory, or symlink). `path` is relative to the workspace root; omit it to list the root. Use this to explore the project layout.

## statPath

Return metadata for a workspace path: whether it is a file or directory, its size in bytes, and its last-modified time. `path` is relative to the workspace root.

## findFiles

Find files by glob pattern (`*` matches within a path segment, `**` matches across segments, `?` matches one character), e.g. `src/**/*.ts`. Returns matching workspace-relative paths. Use this to locate files by name before reading them.

## searchText

Search the text of files in the workspace for a regular expression. Returns matches as `{ path, line, text }`. Narrow the search with an optional `glob` and cap results with `maxResults`. Use this to find where something is defined or used.

## writeFile

Create a file or overwrite it entirely with `contents`. `path` is relative to the workspace root. This is a mutating action and may require the user's approval. Prefer `editFile` for a small, surgical change to an existing file; use `writeFile` for new files or full rewrites.

## editFile

Make a surgical edit to an existing file by replacing `oldString` with `newString`. Unless `replaceAll` is true, `oldString` must occur exactly once so the edit is unambiguous — include enough surrounding context to make it unique. This is a mutating action and may require the user's approval. Returns the before/after so the change can be shown as a diff.

## removePath

Delete a file or directory (recursively) from the workspace. `path` is relative to the workspace root. This is a destructive, mutating action and may require the user's approval. Use it sparingly and only when asked.

## execCommand

Run a program with its working directory pinned to the workspace root. Provide a bare `program` and an `args` array — there is NO shell, so pipes, redirects, globbing, and `&&` do not work. This is a mutating action and may require the user's approval. Never assume it ran; use its returned stdout/stderr and exit code.
